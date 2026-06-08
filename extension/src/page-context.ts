import type { JobPageContext } from "./job-helper";

export type PageContextMessageType =
  | "JOB_HELPER_CAPTURE_PAGE"
  | "JOB_HELPER_COLLECT_PAGE_CONTEXT";

type PageContextResponse = {
  error?: unknown;
  ok?: unknown;
  pageContext?: unknown;
  snapshot?: unknown;
};

export const PAGE_CONTEXT_UNAVAILABLE_MESSAGE =
  "Could not read this page. Refresh the tab, then try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : fallbackMessage;
}

export function isPageContextConnectionError(error: unknown) {
  const message = readErrorMessage(error, "").toLowerCase();

  return (
    message.includes("receiving end does not exist") ||
    message.includes("could not establish connection")
  );
}

export function formatPageContextErrorMessage(
  error: unknown,
  fallbackMessage = "Failed to read the active page.",
) {
  if (isPageContextConnectionError(error)) {
    return PAGE_CONTEXT_UNAVAILABLE_MESSAGE;
  }

  return readErrorMessage(error, fallbackMessage);
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isJobPageContext(value: unknown): value is JobPageContext {
  return (
    isRecord(value) &&
    typeof value.canonicalUrl === "string" &&
    isStringArray(value.companyCandidates) &&
    typeof value.description === "string" &&
    isStringArray(value.employmentTypeCandidates) &&
    isStringArray(value.headings) &&
    Array.isArray(value.jsonLdJobPostings) &&
    isStringArray(value.locationCandidates) &&
    typeof value.rawText === "string" &&
    isStringArray(value.salaryMentions) &&
    typeof value.selectionText === "string" &&
    typeof value.siteName === "string" &&
    typeof value.title === "string" &&
    isStringArray(value.titleCandidates) &&
    isStringArray(value.topTextBlocks) &&
    typeof value.url === "string"
  );
}

function readResponseError(response: PageContextResponse) {
  return typeof response.error === "string" && response.error.trim()
    ? response.error
    : "The content script did not return page details.";
}

function uniqueStrings(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalizedValue = value.replace(/\s+/g, " ").trim();
    const key = normalizedValue.toLowerCase();

    if (!normalizedValue || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalizedValue);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

export function mergeJobPageContextFrames(
  mainContext: JobPageContext,
  frameContexts: readonly JobPageContext[],
): JobPageContext {
  const supplementalContexts = frameContexts.filter(
    (context) => context.url !== mainContext.url || context.rawText !== mainContext.rawText,
  );

  if (supplementalContexts.length === 0) {
    return mainContext;
  }

  return {
    ...mainContext,
    companyCandidates: uniqueStrings(
      [
        ...mainContext.companyCandidates,
        ...supplementalContexts.flatMap((context) => context.companyCandidates),
      ],
      12,
    ),
    employmentTypeCandidates: uniqueStrings(
      [
        ...mainContext.employmentTypeCandidates,
        ...supplementalContexts.flatMap(
          (context) => context.employmentTypeCandidates,
        ),
      ],
      12,
    ),
    headings: uniqueStrings(
      [
        ...mainContext.headings,
        ...supplementalContexts.flatMap((context) => context.headings),
      ],
      20,
    ),
    jsonLdJobPostings: [
      ...mainContext.jsonLdJobPostings,
      ...supplementalContexts.flatMap((context) => context.jsonLdJobPostings),
    ],
    locationCandidates: uniqueStrings(
      [
        ...mainContext.locationCandidates,
        ...supplementalContexts.flatMap((context) => context.locationCandidates),
      ],
      12,
    ),
    rawText: uniqueStrings(
      [
        mainContext.rawText,
        ...supplementalContexts.map((context) => context.rawText),
      ],
      12,
    ).join("\n\n"),
    salaryMentions: uniqueStrings(
      [
        ...mainContext.salaryMentions,
        ...supplementalContexts.flatMap((context) => context.salaryMentions),
      ],
      12,
    ),
    titleCandidates: uniqueStrings(
      [
        ...mainContext.titleCandidates,
        ...supplementalContexts.flatMap((context) => context.titleCandidates),
      ],
      12,
    ),
    topTextBlocks: uniqueStrings(
      [
        ...mainContext.topTextBlocks,
        ...supplementalContexts.flatMap((context) => context.topTextBlocks),
      ],
      16,
    ),
  };
}

async function requestPageContext(
  tabId: number,
  messageType: PageContextMessageType,
) {
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: messageType,
  })) as PageContextResponse | undefined;

  if (!isRecord(response) || response.ok !== true) {
    throw new Error(
      response && isRecord(response)
        ? readResponseError(response)
        : "The content script did not return page details.",
    );
  }

  const pageContext = response.pageContext ?? response.snapshot;

  if (!isJobPageContext(pageContext)) {
    throw new Error("The content script returned unusable page details.");
  }

  return pageContext;
}

function readContentScriptFiles() {
  const manifest = chrome.runtime.getManifest();
  const contentScript = manifest.content_scripts?.find(
    (script) => Array.isArray(script.js) && script.js.length > 0,
  );

  return contentScript?.js ?? [];
}

async function injectContentScript(tabId: number) {
  const files = readContentScriptFiles();

  if (files.length === 0) {
    throw new Error("The Job Helper content script is not available.");
  }

  await chrome.scripting.executeScript({
    files,
    target: { tabId },
  });
}

function collectPageContextInPage(): JobPageContext {
  const cleanText = (value: string | null | undefined, maxLength = 24_000) =>
    (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  const uniqueStrings = (values: string[], limit: number) => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      const normalizedValue = cleanText(value, 1_200);
      const key = normalizedValue.toLowerCase();

      if (!normalizedValue || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(normalizedValue);

      if (result.length >= limit) {
        break;
      }
    }

    return result;
  };
  const queryMetaContent = (selector: string) =>
    cleanText(document.querySelector(selector)?.getAttribute("content"), 1_200);
  const bodyText = cleanText(document.body?.innerText, 24_000);
  const title = cleanText(document.title, 300);
  const siteName =
    queryMetaContent('meta[property="og:site_name"]') ||
    queryMetaContent('meta[name="application-name"]');
  const headings = uniqueStrings(
    Array.from(document.querySelectorAll("h1, h2, h3")).map((heading) =>
      cleanText(heading.textContent, 200),
    ),
    12,
  );
  const salaryMentions = uniqueStrings(
    bodyText.match(
      /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM])?(?:\s*(?:-|–|—|to)\s*(?:[$€£]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM])?)?(?:\s*(?:per year|a year|\/year|yearly|per hour|\/hr|hourly))?)/g,
    ) ?? [],
    8,
  );
  const locationCandidates = uniqueStrings(
    bodyText
      .split(/\n+/)
      .filter((line) =>
        /\b(remote|hybrid|onsite|on-site|in office|in-office)\b/i.test(line),
      ),
    8,
  );
  const employmentTypeCandidates = uniqueStrings(
    bodyText.match(
      /\b(full[- ]?time|part[- ]?time|contract|internship|temporary|intern)\b/gi,
    ) ?? [],
    8,
  );
  const titleCandidates = uniqueStrings(
    [title.split("|")[0] ?? "", title.split("-")[0] ?? "", ...headings.slice(0, 4)],
    8,
  );
  const topTextBlocks = uniqueStrings(
    Array.from(
      document.querySelectorAll(
        "main, article, [role='main'], section, div[data-testid], div[class]",
      ),
    )
      .map((element) => cleanText(element.textContent, 1_200))
      .filter((text) => text.length >= 180)
      .sort((left, right) => right.length - left.length),
    10,
  );

  return {
    canonicalUrl:
      cleanText(document.querySelector("link[rel='canonical']")?.getAttribute("href")) ||
      "",
    companyCandidates: uniqueStrings([siteName], 8),
    description:
      queryMetaContent('meta[name="description"]') ||
      queryMetaContent('meta[property="og:description"]'),
    employmentTypeCandidates,
    headings,
    jsonLdJobPostings: [],
    locationCandidates,
    rawText: bodyText,
    salaryMentions,
    selectionText: cleanText(window.getSelection()?.toString(), 2_000),
    siteName,
    title,
    titleCandidates,
    topTextBlocks,
    url: window.location.href,
  };
}

async function collectPageContextWithOneShotScript(tabId: number) {
  const [result] = await chrome.scripting.executeScript({
    func: collectPageContextInPage,
    target: { tabId },
  });
  const pageContext = result?.result;

  if (!isJobPageContext(pageContext)) {
    throw new Error("The page collector returned unusable page details.");
  }

  return pageContext;
}

async function collectPageContextFromAllFrames(tabId: number) {
  const results = await chrome.scripting.executeScript({
    func: collectPageContextInPage,
    target: { allFrames: true, tabId },
  });

  return results
    .map((result) => result.result)
    .filter(isJobPageContext);
}

async function augmentPageContextWithFrames(
  tabId: number,
  pageContext: JobPageContext,
) {
  try {
    const frameContexts = await collectPageContextFromAllFrames(tabId);

    return mergeJobPageContextFrames(pageContext, frameContexts);
  } catch {
    return pageContext;
  }
}

export async function collectPageContextFromTab(
  tabId: number,
  messageType: PageContextMessageType,
) {
  try {
    return await augmentPageContextWithFrames(
      tabId,
      await requestPageContext(tabId, messageType),
    );
  } catch (firstError) {
    try {
      await injectContentScript(tabId);
    } catch {
      try {
        return await augmentPageContextWithFrames(
          tabId,
          await collectPageContextWithOneShotScript(tabId),
        );
      } catch {
        throw new Error(formatPageContextErrorMessage(firstError));
      }
    }
  }

  try {
    return await augmentPageContextWithFrames(
      tabId,
      await requestPageContext(tabId, messageType),
    );
  } catch (secondError) {
    try {
      return await augmentPageContextWithFrames(
        tabId,
        await collectPageContextWithOneShotScript(tabId),
      );
    } catch {
      throw new Error(formatPageContextErrorMessage(secondError));
    }
  }
}
