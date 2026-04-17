import { compileTailorResumeLatex } from "./tailor-resume-latex.ts";

const linkValidationTimeoutMs = 6_000;
const supportedWebProtocols = new Set(["http:", "https:"]);
const definiteHttpFailureStatusCodes = new Set([400, 404, 410, 451]);
const indeterminateHttpStatusCodes = new Set([401, 403, 408, 429]);
const ignoredGroupedLatexCommands = new Set([
  "hspace",
  "kern",
  "raisebox",
  "vspace",
]);

export type TailorResumeLinkValidationOutcome =
  | "failed"
  | "passed"
  | "unverified";

export type TailorResumeLinkValidationEntry = {
  displayText: string | null;
  outcome: TailorResumeLinkValidationOutcome;
  reason: string | null;
  url: string;
};

export type TailorResumeLinkValidationSummary = {
  failedCount: number;
  passedCount: number;
  totalCount: number;
  unverifiedCount: number;
};

export type TailorResumeLatexDocumentValidationResult =
  | {
      error: null;
      linkSummary: TailorResumeLinkValidationSummary;
      links: TailorResumeLinkValidationEntry[];
      ok: true;
      previewPdf: Buffer;
    }
  | {
      error: string;
      linkSummary: TailorResumeLinkValidationSummary | null;
      links: TailorResumeLinkValidationEntry[];
      ok: false;
      previewPdf: null;
    };

export type ExtractedResumeLatexLink = {
  displayText: string | null;
  url: string;
};

type ValidateTailorResumeLatexDocumentDependencies = {
  compileLatex?: (latexCode: string) => Promise<Buffer>;
  fetchImpl?: typeof fetch;
};

type ValidateTailorResumeLinkDependencies = {
  fetchImpl?: typeof fetch;
  httpProbeCache?: Map<string, Promise<HttpProbeResult>>;
};

function isEscaped(value: string, index: number) {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function readBalancedGroup(value: string, openBraceIndex: number) {
  if (value[openBraceIndex] !== "{") {
    return null;
  }

  let depth = 0;

  for (let index = openBraceIndex; index < value.length; index += 1) {
    const current = value[index];

    if (current === "{" && !isEscaped(value, index)) {
      depth += 1;
      continue;
    }

    if (current === "}" && !isEscaped(value, index)) {
      depth -= 1;

      if (depth === 0) {
        return {
          nextIndex: index + 1,
          value: value.slice(openBraceIndex + 1, index),
        };
      }
    }
  }

  return null;
}

function skipWhitespace(value: string, startIndex: number) {
  let index = startIndex;

  while (index < value.length && /\s/.test(value[index] ?? "")) {
    index += 1;
  }

  return index;
}

function simplifyLatexText(value: string): string {
  let index = 0;
  let result = "";

  while (index < value.length) {
    const current = value[index];

    if (current === "\\") {
      const escapedSymbol = value[index + 1];

      if (escapedSymbol && "{}%$&#_~".includes(escapedSymbol)) {
        result += escapedSymbol === "~" ? " " : escapedSymbol;
        index += 2;
        continue;
      }

      if (escapedSymbol === "\\") {
        result += " ";
        index += 2;
        continue;
      }

      const commandMatch = value.slice(index + 1).match(/^[a-zA-Z]+/);

      if (commandMatch) {
        const command = commandMatch[0];
        index += command.length + 1;
        index = skipWhitespace(value, index);

        if (command === "par") {
          result += " ";
          continue;
        }

        if (value[index] === "{") {
          const group = readBalancedGroup(value, index);

          if (!group) {
            continue;
          }

          if (ignoredGroupedLatexCommands.has(command)) {
            index = group.nextIndex;
            continue;
          }

          result += simplifyLatexText(group.value);
          index = group.nextIndex;
          continue;
        }

        continue;
      }

      index += 1;
      continue;
    }

    if (current === "{") {
      const group = readBalancedGroup(value, index);

      if (!group) {
        index += 1;
        continue;
      }

      result += simplifyLatexText(group.value);
      index = group.nextIndex;
      continue;
    }

    if (current === "}" || current === "%") {
      index += 1;
      continue;
    }

    if (current === "~") {
      result += " ";
      index += 1;
      continue;
    }

    result += current;
    index += 1;
  }

  return result.replace(/\s+/g, " ").trim();
}

function buildLinkSummary(
  links: TailorResumeLinkValidationEntry[],
): TailorResumeLinkValidationSummary {
  return links.reduce<TailorResumeLinkValidationSummary>(
    (summary, link) => {
      summary.totalCount += 1;

      if (link.outcome === "passed") {
        summary.passedCount += 1;
      } else if (link.outcome === "failed") {
        summary.failedCount += 1;
      } else {
        summary.unverifiedCount += 1;
      }

      return summary;
    },
    {
      failedCount: 0,
      passedCount: 0,
      totalCount: 0,
      unverifiedCount: 0,
    },
  );
}

function trimComparableText(value: string) {
  return value.trim().replace(/^[<(["']+/, "").replace(/[>),.\]"']+$/, "");
}

function normalizeHttpUrlForComparison(value: string) {
  const normalizedValue =
    /^https?:\/\//i.test(value) || /^mailto:/i.test(value) || /^tel:/i.test(value)
      ? value
      : `https://${value}`;

  try {
    const parsedUrl = new URL(normalizedValue);

    if (!supportedWebProtocols.has(parsedUrl.protocol)) {
      return null;
    }

    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    return `${hostname}${pathname}${parsedUrl.search}`;
  } catch {
    return null;
  }
}

function extractComparableEmail(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  if (!match) {
    return null;
  }

  return `mailto:${match[0].toLowerCase()}`;
}

function extractComparablePhone(value: string | null) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");

  if (digits.length < 10) {
    return null;
  }

  return `tel:${digits}`;
}

function extractComparableDisplayUrl(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmedValue = trimComparableText(value);

  if (!trimmedValue || !/[./]/.test(trimmedValue)) {
    return null;
  }

  return normalizeHttpUrlForComparison(trimmedValue);
}

function normalizeMailtoTarget(value: string) {
  if (!value.toLowerCase().startsWith("mailto:")) {
    return null;
  }

  const address = value.slice("mailto:".length).split("?")[0]?.trim().toLowerCase();

  if (!address || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(address)) {
    return null;
  }

  return `mailto:${address}`;
}

function normalizeTelTarget(value: string) {
  if (!value.toLowerCase().startsWith("tel:")) {
    return null;
  }

  const digits = value.slice("tel:".length).replace(/\D/g, "");

  if (digits.length < 10) {
    return null;
  }

  return `tel:${digits}`;
}

function buildDisplayMismatchReason(
  displayTarget: string,
  hrefTarget: string,
) {
  return (
    `Visible link text points to ${displayTarget}, but the href target was ${hrefTarget}. ` +
    "Preserve the visible text, but do not invent a different destination."
  );
}

function validateDisplayedTargetConsistency(link: ExtractedResumeLatexLink) {
  const normalizedMailtoTarget = normalizeMailtoTarget(link.url);

  if (normalizedMailtoTarget) {
    const displayEmail = extractComparableEmail(link.displayText);

    if (displayEmail && displayEmail !== normalizedMailtoTarget) {
      return buildDisplayMismatchReason(displayEmail, normalizedMailtoTarget);
    }

    return null;
  }

  const normalizedTelTarget = normalizeTelTarget(link.url);

  if (normalizedTelTarget) {
    const displayPhone = extractComparablePhone(link.displayText);

    if (displayPhone && displayPhone !== normalizedTelTarget) {
      return buildDisplayMismatchReason(displayPhone, normalizedTelTarget);
    }

    return null;
  }

  const normalizedHttpTarget = normalizeHttpUrlForComparison(link.url);
  const displayUrl = extractComparableDisplayUrl(link.displayText);

  if (displayUrl && !normalizedHttpTarget) {
    return (
      `Visible link text points to ${displayUrl}, but the href target was not a valid http or https URL. ` +
      "Preserve the visible text instead of guessing a full destination."
    );
  }

  if (displayUrl && normalizedHttpTarget && displayUrl !== normalizedHttpTarget) {
    return buildDisplayMismatchReason(displayUrl, normalizedHttpTarget);
  }

  if (!normalizedHttpTarget && !normalizedMailtoTarget && !normalizedTelTarget) {
    return "Only http, https, mailto, and tel links are supported in extracted resumes.";
  }

  return null;
}

type HttpProbeResult = {
  outcome: TailorResumeLinkValidationOutcome;
  reason: string | null;
};

async function discardResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore body-cancel cleanup errors from remote peers.
  }
}

function classifyFetchError(error: unknown): HttpProbeResult {
  const cause =
    error instanceof Error && "cause" in error ? (error.cause as { code?: string }) : null;
  const code =
    cause?.code ??
    (error instanceof Error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "");

  if (code === "ENOTFOUND" || code === "ERR_INVALID_URL") {
    return {
      outcome: "failed",
      reason: "The destination could not be resolved.",
    };
  }

  if (code === "ECONNREFUSED") {
    return {
      outcome: "unverified",
      reason: "The destination refused the connection while validating the link.",
    };
  }

  if (
    code === "ABORT_ERR" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return {
      outcome: "unverified",
      reason: "The destination timed out while validating the link.",
    };
  }

  return {
    outcome: "unverified",
    reason:
      error instanceof Error && error.message
        ? error.message
        : "The destination could not be verified.",
  };
}

async function probeHttpMethod(
  url: string,
  method: "GET" | "HEAD",
  fetchImpl: typeof fetch,
) {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "job-helper-link-validator/1.0",
      },
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(linkValidationTimeoutMs),
    });

    await discardResponseBody(response);

    if (response.ok) {
      return {
        outcome: "passed" as const,
        reason: null,
        retryWithGet: false,
      };
    }

    if (definiteHttpFailureStatusCodes.has(response.status)) {
      return {
        outcome: "failed" as const,
        reason: `The destination returned HTTP ${response.status}.`,
        retryWithGet: false,
      };
    }

    if (indeterminateHttpStatusCodes.has(response.status)) {
      return {
        outcome: "unverified" as const,
        reason: `The destination returned HTTP ${response.status} during validation.`,
        retryWithGet: method === "HEAD",
      };
    }

    if (response.status >= 500) {
      return {
        outcome: "unverified" as const,
        reason: `The destination returned HTTP ${response.status} during validation.`,
        retryWithGet: method === "HEAD",
      };
    }

    return {
      outcome: "failed" as const,
      reason: `The destination returned HTTP ${response.status}.`,
      retryWithGet: method === "HEAD",
    };
  } catch (error) {
    const classifiedError = classifyFetchError(error);
    return {
      ...classifiedError,
      retryWithGet: method === "HEAD" && classifiedError.outcome !== "failed",
    };
  }
}

async function probeHttpUrl(url: string, fetchImpl: typeof fetch): Promise<HttpProbeResult> {
  const headProbe = await probeHttpMethod(url, "HEAD", fetchImpl);

  if (!headProbe.retryWithGet) {
    return {
      outcome: headProbe.outcome,
      reason: headProbe.reason,
    };
  }

  const getProbe = await probeHttpMethod(url, "GET", fetchImpl);

  return {
    outcome: getProbe.outcome,
    reason: getProbe.reason,
  };
}

export async function validateTailorResumeLink(
  link: ExtractedResumeLatexLink,
  dependencies: ValidateTailorResumeLinkDependencies = {},
): Promise<TailorResumeLinkValidationEntry> {
  const consistencyError = validateDisplayedTargetConsistency(link);

  if (consistencyError) {
    return {
      displayText: link.displayText,
      outcome: "failed",
      reason: consistencyError,
      url: link.url,
    };
  }

  if (normalizeMailtoTarget(link.url) || normalizeTelTarget(link.url)) {
    return {
      displayText: link.displayText,
      outcome: "passed",
      reason: null,
      url: link.url,
    };
  }

  const normalizedHttpTarget = normalizeHttpUrlForComparison(link.url);

  if (!normalizedHttpTarget) {
    return {
      displayText: link.displayText,
      outcome: "failed",
      reason: "The destination was not a valid http or https URL.",
      url: link.url,
    };
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const probe =
    dependencies.httpProbeCache?.get(link.url) ??
    probeHttpUrl(link.url, fetchImpl).then((result) => result);

  dependencies.httpProbeCache?.set(link.url, probe);
  const probeResult = await probe;

  return {
    displayText: link.displayText,
    outcome: probeResult.outcome,
    reason: probeResult.reason,
    url: link.url,
  };
}


export function extractResumeLatexLinks(
  latexCode: string,
): ExtractedResumeLatexLink[] {
  const links: ExtractedResumeLatexLink[] = [];
  let searchIndex = 0;

  while (searchIndex < latexCode.length) {
    const hrefIndex = latexCode.indexOf("\\href", searchIndex);

    if (hrefIndex === -1) {
      break;
    }

    let cursor = skipWhitespace(latexCode, hrefIndex + "\\href".length);

    if (latexCode[cursor] !== "{") {
      searchIndex = hrefIndex + "\\href".length;
      continue;
    }

    const urlGroup = readBalancedGroup(latexCode, cursor);

    if (!urlGroup) {
      break;
    }

    cursor = skipWhitespace(latexCode, urlGroup.nextIndex);

    if (latexCode[cursor] !== "{") {
      searchIndex = urlGroup.nextIndex;
      continue;
    }

    const labelGroup = readBalancedGroup(latexCode, cursor);

    if (!labelGroup) {
      break;
    }

    const simplifiedDisplayText = simplifyLatexText(labelGroup.value);

    links.push({
      displayText: simplifiedDisplayText || null,
      url: urlGroup.value.trim(),
    });

    searchIndex = labelGroup.nextIndex;
  }

  return links;
}

async function validateResumeLatexLinks(
  latexCode: string,
  fetchImpl: typeof fetch,
) {
  const extractedLinks = extractResumeLatexLinks(latexCode);
  const httpProbeCache = new Map<string, Promise<HttpProbeResult>>();

  const links = await Promise.all(
    extractedLinks.map((link) =>
      validateTailorResumeLink(link, {
        fetchImpl,
        httpProbeCache,
      }),
    ),
  );

  return {
    linkSummary: buildLinkSummary(links),
    links,
  };
}

export async function validateTailorResumeLatexDocument(
  latexCode: string,
  dependencies: ValidateTailorResumeLatexDocumentDependencies = {},
): Promise<TailorResumeLatexDocumentValidationResult> {
  const compileLatex = dependencies.compileLatex ?? compileTailorResumeLatex;
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  try {
    const previewPdf = await compileLatex(latexCode);
    const linkValidation = await validateResumeLatexLinks(latexCode, fetchImpl);

    return {
      error: null,
      linkSummary: linkValidation.linkSummary,
      links: linkValidation.links,
      ok: true,
      previewPdf,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to compile the LaTeX preview.",
      linkSummary: null,
      links: [],
      ok: false,
      previewPdf: null,
    };
  }
}
