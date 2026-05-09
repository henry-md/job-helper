import {
  readTailorResumeGenerationStepSummary,
  type TailorResumeGenerationStepSummary,
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
  | { kind: "reset" };

function readTailorResumeInterviewStreamField(value: unknown) {
  return value === "assistantMessage" || value === "completionMessage"
    ? value
    : null;
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

  return null;
}

export async function readTailorResumeGenerationStream(
  response: Response,
  handlers: {
    onInterviewStreamEvent?: (
      interviewStreamEvent: TailorResumeInterviewStreamEvent,
    ) => void;
    onStepEvent?: (stepEvent: TailorResumeGenerationStepSummary) => void;
    onUserMemoryEvent?: (payload: Record<string, unknown>) => void;
  },
) {
  return readSharedTailorResumeGenerationStream(response, {
    onInterviewStreamEvent: handlers.onInterviewStreamEvent,
    onStepEvent: handlers.onStepEvent,
    onUserMemoryEvent: handlers.onUserMemoryEvent,
    parseInterviewStreamEvent: readTailorResumeInterviewStreamEvent,
    parsePayload: (value) =>
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {},
    parseStepEvent: readTailorResumeGenerationStepSummary,
    parseUserMemoryPayload: (value) =>
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {},
  }) as Promise<TailorResumeRunStreamResult<Record<string, unknown>>>;
}
