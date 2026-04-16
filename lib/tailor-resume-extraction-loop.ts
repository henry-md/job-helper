import type { ExtractedTailorResumeLink } from "@/lib/tailor-resume-links";
import type {
  TailorResumeLatexDocumentValidationResult,
  TailorResumeLinkValidationEntry,
  TailorResumeLinkValidationSummary,
} from "@/lib/tailor-resume-link-validation";

export const maxResumeLatexAttempts = 3;
export const resumeLatexValidationToolName = "validate_resume_latex";

export const resumeLatexValidationTool = {
  type: "function",
  name: resumeLatexValidationToolName,
  description:
    "Compile a full standalone LaTeX resume candidate with pdflatex, validate any extracted hyperlinks, and return exact issues so they can be fixed.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      latexCode: { type: "string" },
      links: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            url: {
              type: ["string", "null"],
            },
          },
          required: ["label", "url"],
        },
      },
    },
    required: ["latexCode", "links"],
  },
} as const;

type ResumeLatexMessageOutput = {
  type?: string;
  text?: string;
};

type ResumeLatexOutputItem = {
  arguments?: string;
  call_id?: string;
  content?: ResumeLatexMessageOutput[];
  name?: string;
  type?: string;
};

type ResumeLatexToolCall = {
  arguments: string;
  call_id: string;
  name: string;
  type: "function_call";
};

export type ResumeLatexLoopResponse = {
  id?: string;
  model?: string;
  output?: ResumeLatexOutputItem[];
  output_text?: string;
};

export type ResumeLatexRetryContext = {
  attempt: number;
  error: string;
  failedLinks: Array<{
    displayText: string | null;
    reason: string | null;
    url: string;
  }>;
  linkSummary: TailorResumeLinkValidationSummary | null;
  previousLatexCode: string | null;
  previousModelOutput: string | null;
  previousResumeLinks: ExtractedTailorResumeLink[];
  remainingAttempts: number;
  retryType: "response_error" | "validation_failure";
};

export type ResumeLatexLoopInput = ResumeLatexRetryContext;

export type RunResumeLatexToolLoopArgs = {
  createResponse: (input: {
    attempt: number;
    previousResponseId?: string;
    input?: ResumeLatexLoopInput;
  }) => Promise<ResumeLatexLoopResponse>;
  fallbackModel: string;
  maxAttempts?: number;
  onAttemptEvent?: (
    attemptEvent: RunResumeLatexToolLoopResult["attemptEvents"][number],
  ) => void | Promise<void>;
  validateLatex: (
    latexCode: string,
  ) => Promise<TailorResumeLatexDocumentValidationResult>;
};

export type RunResumeLatexToolLoopResult = {
  attempts: number;
  attemptEvents: Array<{
    attempt: number;
    error: string | null;
    linkSummary: TailorResumeLinkValidationSummary | null;
    outcome: "failed" | "succeeded";
    willRetry: boolean;
  }>;
  latexCode: string;
  links: TailorResumeLinkValidationEntry[];
  linkSummary: TailorResumeLinkValidationSummary | null;
  model: string;
  previewPdf: Buffer | null;
  extractedResumeLinks: ExtractedTailorResumeLink[];
  validationError: string | null;
};

function readOutputText(response: ResumeLatexLoopResponse) {
  if (response.output_text) {
    return response.output_text;
  }

  const chunks: string[] = [];

  for (const outputItem of response.output ?? []) {
    if (outputItem.type !== "message") {
      continue;
    }

    for (const content of outputItem.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("").trim();
}

function readExtractedResumeLinks(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("links" in value) ||
    !Array.isArray(value.links)
  ) {
    return [] as ExtractedTailorResumeLink[];
  }

  return value.links.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const label =
      "label" in entry && typeof entry.label === "string" ? entry.label.trim() : "";
    const url =
      "url" in entry && (typeof entry.url === "string" || entry.url === null)
        ? entry.url
        : null;

    if (!label) {
      return [];
    }

    return [{ label, url }];
  });
}

function readExtractedLatexDocument(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("latexCode" in value) ||
    typeof value.latexCode !== "string"
  ) {
    throw new Error("The model did not return a LaTeX document.");
  }

  const latexCode = value.latexCode.trim();

  if (!latexCode) {
    throw new Error("The model returned an empty LaTeX document.");
  }

  return {
    latexCode,
    links: readExtractedResumeLinks(value),
  };
}

function buildResponseFailureRetryContext(input: {
  attempt: number;
  error: string;
  maxAttempts: number;
  previousLatexCode?: string | null;
  previousModelOutput?: string | null;
  previousResumeLinks?: ExtractedTailorResumeLink[];
}): ResumeLatexRetryContext {
  return {
    attempt: input.attempt,
    error: input.error,
    failedLinks: [],
    linkSummary: null,
    previousLatexCode: input.previousLatexCode ?? null,
    previousModelOutput: input.previousModelOutput?.trim() || null,
    previousResumeLinks: input.previousResumeLinks ?? [],
    remainingAttempts: input.maxAttempts - input.attempt,
    retryType: "response_error",
  };
}

function buildValidationFailureRetryContext(input: {
  attempt: number;
  validation: Extract<TailorResumeLatexDocumentValidationResult, { ok: false }>;
  previousLatexCode: string;
  previousResumeLinks: ExtractedTailorResumeLink[];
  maxAttempts: number;
}): ResumeLatexRetryContext {
  const failedLinks = readFailedLinks(input.validation.links);

  return {
    attempt: input.attempt,
    error: input.validation.error,
    failedLinks,
    linkSummary: input.validation.linkSummary,
    previousLatexCode: input.previousLatexCode,
    previousModelOutput: null,
    previousResumeLinks: input.previousResumeLinks,
    remainingAttempts: input.maxAttempts - input.attempt,
    retryType: "validation_failure",
  };
}

function buildRetryExhaustedError(lastError: string | null, maxAttempts: number) {
  if (!lastError) {
    return `Unable to produce a compilable LaTeX resume after ${maxAttempts} attempts.`;
  }

  return (
    `Unable to produce a compilable LaTeX resume after ${maxAttempts} attempts.\n\n` +
    `Last validation error:\n${lastError}`
  );
}

function findResumeLatexToolCall(
  response: ResumeLatexLoopResponse,
): ResumeLatexToolCall | null {
  for (const outputItem of response.output ?? []) {
    if (
      outputItem.type === "function_call" &&
      outputItem.name === resumeLatexValidationToolName &&
      typeof outputItem.call_id === "string" &&
      typeof outputItem.arguments === "string"
    ) {
      return {
        arguments: outputItem.arguments,
        call_id: outputItem.call_id,
        name: outputItem.name,
        type: "function_call",
      };
    }
  }

  return null;
}

function readFailedLinks(links: TailorResumeLinkValidationEntry[]) {
  return links
    .filter((link) => link.outcome === "failed")
    .map((link) => ({
      displayText: link.displayText,
      reason: link.reason,
      url: link.url,
    }));
}

export async function runResumeLatexToolLoop(
  args: RunResumeLatexToolLoopArgs,
): Promise<RunResumeLatexToolLoopResult> {
  const maxAttempts = args.maxAttempts ?? maxResumeLatexAttempts;
  const attemptEvents: RunResumeLatexToolLoopResult["attemptEvents"] = [];
  let previousResponseId: string | undefined;
  let nextInput: ResumeLatexLoopInput | undefined;
  let lastError: string | null = null;
  let lastLatexCode: string | null = null;
  let lastLinks: TailorResumeLinkValidationEntry[] = [];
  let lastLinkSummary: TailorResumeLinkValidationSummary | null = null;
  let lastResumeLinks: ExtractedTailorResumeLink[] = [];
  let resolvedModel: string | null = null;

  async function recordAttemptEvent(
    attemptEvent: RunResumeLatexToolLoopResult["attemptEvents"][number],
  ) {
    attemptEvents.push(attemptEvent);
    await args.onAttemptEvent?.(attemptEvent);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await args.createResponse({
      attempt,
      input: nextInput,
      previousResponseId,
    });

    if (typeof response.id === "string") {
      previousResponseId = response.id;
    }

    if (typeof response.model === "string" && response.model.length > 0) {
      resolvedModel = response.model;
    }

    const toolCall = findResumeLatexToolCall(response);

    if (!toolCall) {
      const outputText = readOutputText(response);

      if (outputText) {
        try {
          const fallbackDocument = readExtractedLatexDocument(JSON.parse(outputText));
          lastLatexCode = fallbackDocument.latexCode;
          lastResumeLinks = fallbackDocument.links;
          const validation = await args.validateLatex(fallbackDocument.latexCode);
          lastLinks = validation.links;
          lastLinkSummary = validation.linkSummary;

          if (!validation.ok) {
            lastError = validation.error;

            await recordAttemptEvent({
              attempt,
              error: lastError,
              linkSummary: validation.linkSummary,
              outcome: "failed",
              willRetry: attempt < maxAttempts,
            });

            if (attempt === maxAttempts) {
              break;
            }

            nextInput = buildValidationFailureRetryContext({
              attempt,
              maxAttempts,
              previousLatexCode: fallbackDocument.latexCode,
              previousResumeLinks: fallbackDocument.links,
              validation,
            });
            continue;
          }

          await recordAttemptEvent({
            attempt,
            error: null,
            linkSummary: validation.linkSummary,
            outcome: "succeeded",
            willRetry: false,
          });

          return {
            attempts: attempt,
            attemptEvents,
            latexCode: fallbackDocument.latexCode,
            links: validation.links,
            linkSummary: validation.linkSummary,
            model: resolvedModel ?? args.fallbackModel,
            previewPdf: validation.previewPdf,
            extractedResumeLinks: fallbackDocument.links,
            validationError: null,
          };
        } catch (error) {
          lastError =
            error instanceof Error
              ? error.message
              : `The model did not call ${resumeLatexValidationToolName}.`;
        }
      } else {
        lastError = `The model did not call ${resumeLatexValidationToolName}.`;
      }

      await recordAttemptEvent({
        attempt,
        error: lastError,
        linkSummary: lastLinkSummary,
        outcome: "failed",
        willRetry: attempt < maxAttempts,
      });

      if (attempt === maxAttempts) {
        break;
      }

      nextInput = buildResponseFailureRetryContext({
        attempt,
        error: lastError,
        maxAttempts,
        previousModelOutput: outputText || null,
      });
      continue;
    }

    try {
      const extractedDocument = readExtractedLatexDocument(JSON.parse(toolCall.arguments));
      lastLatexCode = extractedDocument.latexCode;
      lastResumeLinks = extractedDocument.links;
      const validation = await args.validateLatex(extractedDocument.latexCode);
      lastLinks = validation.links;
      lastLinkSummary = validation.linkSummary;

      if (!validation.ok) {
        lastError = validation.error;

        await recordAttemptEvent({
          attempt,
          error: lastError,
          linkSummary: validation.linkSummary,
          outcome: "failed",
          willRetry: attempt < maxAttempts,
        });

        if (attempt === maxAttempts) {
          break;
        }

        nextInput = buildValidationFailureRetryContext({
          attempt,
          maxAttempts,
          previousLatexCode: extractedDocument.latexCode,
          previousResumeLinks: extractedDocument.links,
          validation,
        });
        continue;
      }

      await recordAttemptEvent({
        attempt,
        error: null,
        linkSummary: validation.linkSummary,
        outcome: "succeeded",
        willRetry: false,
      });

      return {
        attempts: attempt,
        attemptEvents,
        latexCode: extractedDocument.latexCode,
        links: validation.links,
        linkSummary: validation.linkSummary,
        model: resolvedModel ?? args.fallbackModel,
        previewPdf: validation.previewPdf,
        extractedResumeLinks: extractedDocument.links,
        validationError: null,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Unable to validate the generated LaTeX document.";

      await recordAttemptEvent({
        attempt,
        error: lastError,
        linkSummary: lastLinkSummary,
        outcome: "failed",
        willRetry: attempt < maxAttempts,
      });

      if (attempt === maxAttempts) {
        break;
      }

      nextInput = buildResponseFailureRetryContext({
        attempt,
        error: lastError,
        maxAttempts,
        previousModelOutput: toolCall.arguments,
      });
    }
  }

  if (!lastLatexCode) {
    throw new Error(buildRetryExhaustedError(lastError, maxAttempts));
  }

  return {
    attempts: maxAttempts,
    attemptEvents,
    latexCode: lastLatexCode,
    links: lastLinks,
    linkSummary: lastLinkSummary,
    model: resolvedModel ?? args.fallbackModel,
    previewPdf: null,
    extractedResumeLinks: lastResumeLinks,
    validationError: buildRetryExhaustedError(lastError, maxAttempts),
  };
}
