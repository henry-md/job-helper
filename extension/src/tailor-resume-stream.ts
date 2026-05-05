import {
  readTailorResumeGenerationStepSummary,
  type TailorResumeGenerationStepSummary,
  type TailorResumeTechnologyContext,
} from "./job-helper";
import {
  isNdjsonResponse,
  readTailorResumeGenerationStream as readSharedTailorResumeGenerationStream,
  type TailorResumeRunStreamResult,
} from "../../lib/tailor-resume-client-stream.ts";

export { isNdjsonResponse };

export type TailorResumeInterviewStreamEvent =
  | {
      field: "assistantMessage" | "completionMessage";
      kind: "text-start";
    }
  | {
      delta: string;
      field: "assistantMessage" | "completionMessage";
      kind: "text-delta";
    }
  | {
      card: TailorResumeTechnologyContext;
      kind: "card";
    }
  | { kind: "reset" };

function readTailorResumeInterviewStreamField(value: unknown) {
  return value === "assistantMessage" || value === "completionMessage"
    ? value
    : null;
}

function readTailorResumeInterviewTechnologyContext(
  value: unknown,
): TailorResumeTechnologyContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const definition =
    typeof record.definition === "string" ? record.definition.trim() : "";
  const examples = Array.isArray(record.examples)
    ? record.examples
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

  if (!name || !definition || examples.length < 2) {
    return null;
  }

  return {
    definition,
    examples,
    name,
  };
}

function readTailorResumeInterviewStreamEvent(
  value: unknown,
): TailorResumeInterviewStreamEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record.kind === "reset") {
    return { kind: "reset" };
  }

  if (record.kind === "text-start") {
    const field = readTailorResumeInterviewStreamField(record.field);

    return field ? { field, kind: "text-start" } : null;
  }

  if (record.kind === "text-delta") {
    const field = readTailorResumeInterviewStreamField(record.field);

    if (!field || typeof record.delta !== "string") {
      return null;
    }

    return {
      delta: record.delta,
      field,
      kind: "text-delta",
    };
  }

  if (record.kind === "card") {
    const card = readTailorResumeInterviewTechnologyContext(record.card);

    return card ? { card, kind: "card" } : null;
  }

  return null;
}

export async function readTailorResumeGenerationStream(
  response: Response,
  handlers: {
    onInterviewStreamEvent?: (
      interviewStreamEvent: TailorResumeInterviewStreamEvent,
    ) => void;
    onStepEvent?: (stepEvent: TailorResumeGenerationStepSummary) => void;
  },
) {
  return readSharedTailorResumeGenerationStream(response, {
    onInterviewStreamEvent: handlers.onInterviewStreamEvent,
    onStepEvent: handlers.onStepEvent,
    parseInterviewStreamEvent: readTailorResumeInterviewStreamEvent,
    parsePayload: (value) =>
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {},
    parseStepEvent: readTailorResumeGenerationStepSummary,
  }) as Promise<TailorResumeRunStreamResult<Record<string, unknown>>>;
}
