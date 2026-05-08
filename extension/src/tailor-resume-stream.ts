import {
  readTailorResumeGenerationStepSummary,
  type TailorResumeGenerationStepSummary,
  type TailorResumeTechnologyContext,
  type TailorResumeTechnologyExample,
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

function normalizeExampleTermMatchText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeExampleTermRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function technologyExampleContainsTerm(input: {
  term: string;
  text: string;
}) {
  const term = normalizeExampleTermMatchText(input.term);
  const text = normalizeExampleTermMatchText(input.text).replace(
    /\s(?:--|[-–—])\s*[^-–—]+?\s*$/,
    "",
  );

  if (!term) {
    return false;
  }

  const escapedTerm = escapeExampleTermRegExp(term).replace(/\s+/g, "\\s+");
  const regexp = new RegExp(`(^|[^a-z0-9])${escapedTerm}(?=$|[^a-z0-9])`, "i");

  return regexp.test(text);
}

function readTailorResumeTechnologyExample(
  value: unknown,
): TailorResumeTechnologyExample[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const example = value as Record<string, unknown>;
  const text = typeof example.text === "string" ? example.text.trim() : "";
  const kind =
    example.kind === "existing" || example.kind === "new"
      ? example.kind
      : null;

  return text && kind ? [{ kind, text }] : [];
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
    ? record.examples.flatMap(readTailorResumeTechnologyExample)
    : [];

  if (
    !name ||
    !definition ||
    examples.length < 2 ||
    !examples.every((example) =>
      technologyExampleContainsTerm({
        term: name,
        text: example.text,
      }),
    )
  ) {
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
