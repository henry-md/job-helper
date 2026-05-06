import { readAnnotatedTailorResumeBlocks } from "./tailor-resume-segmentation.ts";
import type {
  TailorResumeGenerationStepEvent,
  TailoredResumeEmphasizedTechnology,
  TailoredResumeThesis,
} from "./tailor-resume-types.ts";

export const tailorResumeDebugErrorSources = {
  extractionCompileFailure: "extraction-compile-failure",
  stepTwoChatServedError: "step-two-chat-served-error",
  tailoringCompileFailure: "tailoring-compile-failure",
  tailoringInvalidReplacement: "tailoring-invalid-replacement",
} as const;

export type TailorResumeDebugErrorCategory =
  | "chat_error"
  | "step_failure"
  | "bad_latex_generation"
  | "invalid_replacement";

export function buildTailorResumeStepFailureDebugSource(stepNumber: number) {
  const normalizedStepNumber =
    Number.isFinite(stepNumber) && stepNumber >= 1 && stepNumber <= 5
      ? Math.floor(stepNumber)
      : 0;

  return normalizedStepNumber > 0
    ? (`step-${normalizedStepNumber}-failure` as const)
    : "step-unknown-failure";
}

export function isTailorResumeStepFailureDebugSource(source: string) {
  return /^step-(?:[1-5]|unknown)-failure$/.test(source);
}

export function classifyTailorResumeDebugErrorSource(
  source: string,
): TailorResumeDebugErrorCategory {
  if (isTailorResumeStepFailureDebugSource(source)) {
    return "step_failure";
  }

  if (source === tailorResumeDebugErrorSources.stepTwoChatServedError) {
    return "chat_error";
  }

  if (source === tailorResumeDebugErrorSources.tailoringInvalidReplacement) {
    return "invalid_replacement";
  }

  return "bad_latex_generation";
}

export function formatTailorResumeDebugErrorSource(source: string) {
  if (isTailorResumeStepFailureDebugSource(source)) {
    const stepNumber = source.match(/^step-(\d+)-failure$/)?.[1];

    return stepNumber ? `Step ${stepNumber} failure` : "Step failure";
  }

  switch (source) {
    case tailorResumeDebugErrorSources.extractionCompileFailure:
      return "Extraction compile failure";
    case tailorResumeDebugErrorSources.stepTwoChatServedError:
      return "Step 2 chat error";
    case tailorResumeDebugErrorSources.tailoringCompileFailure:
      return "Tailoring compile failure";
    case tailorResumeDebugErrorSources.tailoringInvalidReplacement:
      return "Tailoring invalid replacement";
    case "extraction":
      return "Extraction compile failure (legacy)";
    case "tailoring":
      return "Tailoring compile failure (legacy)";
    default:
      return source;
  }
}

export function formatTailorResumeDebugPayloadLabel(source: string) {
  if (classifyTailorResumeDebugErrorSource(source) === "step_failure") {
    return "Step failure context";
  }

  if (classifyTailorResumeDebugErrorSource(source) === "chat_error") {
    return "Chat context";
  }

  return classifyTailorResumeDebugErrorSource(source) === "invalid_replacement"
    ? "Rejected payload"
    : "Generated LaTeX";
}

export function normalizeTailorResumeDebugErrorSignature(error: string) {
  return error
    .replace(/segment [A-Za-z0-9_.-]+/g, "segment <id>")
    .replace(/resume\.tex:\d+/g, "resume.tex:<line>")
    .replace(/\s+/g, " ")
    .trim();
}

type ParsedTailorResumeInvalidReplacementStructuredChange = {
  latexCode: string;
  reason: string;
  segmentId: string;
};

export type ParsedTailorResumeInvalidReplacementChange = {
  replacementLatexCode: string;
  segmentId: string;
  sourceCommand: string | null;
  sourceLatexCode: string | null;
  reason: string;
};

export type ParsedTailorResumeInvalidReplacementStructuredResponse = {
  changes: ParsedTailorResumeInvalidReplacementStructuredChange[];
  companyName: string | null;
  displayName: string | null;
  jobIdentifier: string | null;
  positionTitle: string | null;
  thesis: TailoredResumeThesis | null;
};

export type ParsedTailorResumeInvalidReplacementPayload = {
  annotatedLatexCode: string;
  changes: ParsedTailorResumeInvalidReplacementChange[];
  structuredResponse: ParsedTailorResumeInvalidReplacementStructuredResponse | null;
  structuredResponseJson: string | null;
  validationError: string | null;
};

export type TailorResumeStepFailureLogPayload = {
  action: string | null;
  applicationId: string | null;
  interviewId: string | null;
  jobDescription: string | null;
  jobUrl: string | null;
  kind: "tailor_resume_step_failure";
  loggedAt: string;
  logKind: "step-event" | "terminal-run-status";
  runId: string | null;
  step: {
    attempt: number | null;
    detail: string | null;
    durationMs: number;
    emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
    retrying: boolean;
    status: TailorResumeGenerationStepEvent["status"];
    stepCount: number;
    stepNumber: number;
    summary: string;
  };
  tailoredResumeId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

function readCodeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function trimLongDebugText(value: string | null | undefined, maxLength = 6000) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) {
    return null;
  }

  return text.length > maxLength
    ? `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} chars]`
    : text;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function parseEmphasizedTechnologies(
  value: unknown,
): TailoredResumeEmphasizedTechnology[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const name = readOptionalString(entry.name);
    const priority = readOptionalString(entry.priority);
    const evidence = readOptionalString(entry.evidence);

    if (!name || (priority !== "high" && priority !== "low") || !evidence) {
      return [];
    }

    return [{ evidence, name, priority }];
  });
}

export function buildTailorResumeStepFailureLogPayload(input: {
  action?: string | null;
  applicationId?: string | null;
  event: TailorResumeGenerationStepEvent;
  interviewId?: string | null;
  jobDescription?: string | null;
  jobUrl?: string | null;
  loggedAt?: string;
  logKind: TailorResumeStepFailureLogPayload["logKind"];
  runId?: string | null;
  tailoredResumeId?: string | null;
}) {
  const payload: TailorResumeStepFailureLogPayload = {
    action: input.action?.trim() || null,
    applicationId: input.applicationId?.trim() || null,
    interviewId: input.interviewId?.trim() || null,
    jobDescription: trimLongDebugText(input.jobDescription),
    jobUrl: input.jobUrl?.trim() || null,
    kind: "tailor_resume_step_failure",
    loggedAt: input.loggedAt ?? new Date().toISOString(),
    logKind: input.logKind,
    runId: input.runId?.trim() || null,
    step: {
      attempt: input.event.attempt,
      detail: input.event.detail,
      durationMs: input.event.durationMs,
      emphasizedTechnologies: input.event.emphasizedTechnologies ?? [],
      retrying: input.event.retrying,
      status: input.event.status,
      stepCount: input.event.stepCount,
      stepNumber: input.event.stepNumber,
      summary: input.event.summary,
    },
    tailoredResumeId: input.tailoredResumeId?.trim() || null,
  };

  return JSON.stringify(payload, null, 2);
}

export function parseTailorResumeStepFailureLogPayload(
  payload: string,
): TailorResumeStepFailureLogPayload | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.kind !== "tailor_resume_step_failure") {
    return null;
  }

  const step = isRecord(parsed.step) ? parsed.step : null;
  const stepNumber = readNumber(step?.stepNumber);
  const stepCount = readNumber(step?.stepCount);
  const durationMs = readNumber(step?.durationMs);
  const summary = readOptionalString(step?.summary);
  const status = readOptionalString(step?.status);

  if (
    !step ||
    !stepNumber ||
    !stepCount ||
    durationMs === null ||
    !summary ||
    (status !== "failed" &&
      status !== "running" &&
      status !== "skipped" &&
      status !== "succeeded")
  ) {
    return null;
  }

  return {
    action: readOptionalString(parsed.action),
    applicationId: readOptionalString(parsed.applicationId),
    interviewId: readOptionalString(parsed.interviewId),
    jobDescription: readOptionalString(parsed.jobDescription),
    jobUrl: readOptionalString(parsed.jobUrl),
    kind: "tailor_resume_step_failure",
    loggedAt:
      readOptionalString(parsed.loggedAt) ?? new Date(0).toISOString(),
    logKind:
      parsed.logKind === "terminal-run-status"
        ? "terminal-run-status"
        : "step-event",
    runId: readOptionalString(parsed.runId),
    step: {
      attempt: readNumber(step.attempt),
      detail: readOptionalString(step.detail),
      durationMs,
      emphasizedTechnologies: parseEmphasizedTechnologies(
        step.emphasizedTechnologies,
      ),
      retrying: readBoolean(step.retrying) ?? false,
      status,
      stepCount,
      stepNumber,
      summary,
    },
    tailoredResumeId: readOptionalString(parsed.tailoredResumeId),
  };
}

function parseTailorResumeThesis(value: unknown): TailoredResumeThesis | null {
  if (!isRecord(value)) {
    return null;
  }

  const jobDescriptionFocus = readOptionalString(value.jobDescriptionFocus);
  const resumeChanges = readOptionalString(value.resumeChanges);

  if (!jobDescriptionFocus || !resumeChanges) {
    return null;
  }

  return {
    jobDescriptionFocus,
    resumeChanges,
  };
}

function parseStructuredChange(
  value: unknown,
): ParsedTailorResumeInvalidReplacementStructuredChange | null {
  if (!isRecord(value)) {
    return null;
  }

  const segmentId = readOptionalString(value.segmentId);

  if (!segmentId) {
    return null;
  }

  return {
    latexCode: readCodeString(value.latexCode),
    reason: readOptionalString(value.reason) ?? "",
    segmentId,
  };
}

function parseStructuredResponse(
  value: unknown,
): ParsedTailorResumeInvalidReplacementStructuredResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const changes = Array.isArray(value.changes)
    ? value.changes.flatMap((entry) => {
        const parsed = parseStructuredChange(entry);
        return parsed ? [parsed] : [];
      })
    : [];

  return {
    changes,
    companyName: readOptionalString(value.companyName),
    displayName: readOptionalString(value.displayName),
    jobIdentifier: readOptionalString(value.jobIdentifier),
    positionTitle: readOptionalString(value.positionTitle),
    thesis: parseTailorResumeThesis(value.thesis),
  };
}

function readDebugPayloadSection(
  payload: string,
  startMarker: string,
  endMarker?: string,
) {
  const startIndex = payload.indexOf(startMarker);

  if (startIndex === -1) {
    return null;
  }

  const contentStart = startIndex + startMarker.length;
  const contentEnd = endMarker
    ? payload.indexOf(endMarker, contentStart)
    : payload.length;

  if (contentEnd === -1) {
    return payload.slice(contentStart).trim();
  }

  return payload.slice(contentStart, contentEnd).trim();
}

export function parseTailorResumeInvalidReplacementPayload(
  payload: string,
): ParsedTailorResumeInvalidReplacementPayload | null {
  if (!payload.includes("Tailor Resume invalid replacement")) {
    return null;
  }

  const validationError = readDebugPayloadSection(
    payload,
    "Validation error:\n",
    "\n\nStructured response:\n",
  );
  const structuredResponseJson = readDebugPayloadSection(
    payload,
    "Structured response:\n",
    "\n\nReferenced source blocks:\n",
  );
  const annotatedLatexCode = readDebugPayloadSection(
    payload,
    "Annotated source LaTeX:\n",
  );

  if (!annotatedLatexCode) {
    return null;
  }

  let structuredResponse: ParsedTailorResumeInvalidReplacementStructuredResponse | null =
    null;

  if (structuredResponseJson) {
    try {
      structuredResponse = parseStructuredResponse(
        JSON.parse(structuredResponseJson) as unknown,
      );
    } catch {
      structuredResponse = null;
    }
  }

  const sourceBlocksById = (() => {
    try {
      return new Map(
        readAnnotatedTailorResumeBlocks(annotatedLatexCode).map((block) => [
          block.id,
          block,
        ]),
      );
    } catch {
      return new Map();
    }
  })();

  const changes =
    structuredResponse?.changes.map((change) => {
      const sourceBlock = sourceBlocksById.get(change.segmentId);

      return {
        replacementLatexCode: change.latexCode,
        segmentId: change.segmentId,
        sourceCommand: sourceBlock?.command ?? null,
        sourceLatexCode: sourceBlock?.latexCode ?? null,
        reason: change.reason,
      };
    }) ?? [];

  return {
    annotatedLatexCode,
    changes,
    structuredResponse,
    structuredResponseJson,
    validationError,
  };
}
