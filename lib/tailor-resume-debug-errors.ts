import { readAnnotatedTailorResumeBlocks } from "./tailor-resume-segmentation.ts";
import type { TailoredResumeThesis } from "./tailor-resume-types.ts";

export const tailorResumeDebugErrorSources = {
  extractionCompileFailure: "extraction-compile-failure",
  tailoringCompileFailure: "tailoring-compile-failure",
  tailoringInvalidReplacement: "tailoring-invalid-replacement",
} as const;

export type TailorResumeDebugErrorCategory =
  | "bad_latex_generation"
  | "invalid_replacement";

export function classifyTailorResumeDebugErrorSource(
  source: string,
): TailorResumeDebugErrorCategory {
  if (source === tailorResumeDebugErrorSources.tailoringInvalidReplacement) {
    return "invalid_replacement";
  }

  return "bad_latex_generation";
}

export function formatTailorResumeDebugErrorSource(source: string) {
  switch (source) {
    case tailorResumeDebugErrorSources.extractionCompileFailure:
      return "Extraction compile failure";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

function readCodeString(value: unknown) {
  return typeof value === "string" ? value : "";
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
