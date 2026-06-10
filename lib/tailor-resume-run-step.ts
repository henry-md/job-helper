import type { TailorResumeGenerationStepEvent } from "./tailor-resume-types.ts";

function readPositiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTailorResumeGenerationStepStatus(value: unknown) {
  return value === "failed" ||
    value === "running" ||
    value === "skipped" ||
    value === "succeeded"
    ? value
    : null;
}

function readTailorResumeGenerationStepTiming(
  value: unknown,
): TailorResumeGenerationStepEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const stepNumber = readNumber(value.stepNumber);
  const stepCount = readNumber(value.stepCount);
  const status = readTailorResumeGenerationStepStatus(value.status);
  const summary = readString(value.summary);

  if (!stepNumber || !stepCount || !status || !summary) {
    return null;
  }

  const attempt = readNumber(value.attempt);

  return {
    attempt: attempt > 0 ? Math.floor(attempt) : null,
    blockingTechnologies: Array.isArray(value.blockingTechnologies)
      ? (value.blockingTechnologies as TailorResumeGenerationStepEvent["blockingTechnologies"])
      : undefined,
    detail: readNullableString(value.detail),
    durationMs: Math.max(0, Math.floor(readNumber(value.durationMs))),
    emphasizedTechnologies: Array.isArray(value.emphasizedTechnologies)
      ? (value.emphasizedTechnologies as TailorResumeGenerationStepEvent["emphasizedTechnologies"])
      : undefined,
    model: readNullableString(value.model),
    retrying: value.retrying === true,
    status,
    stepCount: Math.max(1, Math.floor(stepCount)),
    stepNumber: Math.max(1, Math.floor(stepNumber)),
    summary,
  };
}

export function readTailorResumeGenerationStepTimingHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TailorResumeGenerationStepEvent[];
  }

  return value
    .map(readTailorResumeGenerationStepTiming)
    .filter((event): event is TailorResumeGenerationStepEvent => Boolean(event));
}

function buildTailorResumeGenerationStepTimingKey(
  event: TailorResumeGenerationStepEvent,
) {
  return `${event.stepNumber}:${event.attempt ?? 1}`;
}

export function mergeTailorResumeGenerationStepTimingHistory(input: {
  event: TailorResumeGenerationStepEvent;
  previousTimings: unknown;
}) {
  const timingsByKey = new Map<string, TailorResumeGenerationStepEvent>();

  for (const previousTiming of readTailorResumeGenerationStepTimingHistory(
    input.previousTimings,
  )) {
    timingsByKey.set(
      buildTailorResumeGenerationStepTimingKey(previousTiming),
      previousTiming,
    );
  }

  const previousTiming = timingsByKey.get(
    buildTailorResumeGenerationStepTimingKey(input.event),
  );
  const durationMs = Math.max(
    previousTiming?.durationMs ?? 0,
    input.event.durationMs,
  );
  const nextTiming = {
    ...previousTiming,
    ...input.event,
    durationMs,
  } satisfies TailorResumeGenerationStepEvent;

  timingsByKey.set(buildTailorResumeGenerationStepTimingKey(nextTiming), nextTiming);

  return [...timingsByKey.values()].sort(
    (left, right) =>
      left.stepNumber - right.stepNumber ||
      (left.attempt ?? 1) - (right.attempt ?? 1),
  );
}

export function buildTailorResumeRunStepUpdate(
  event: TailorResumeGenerationStepEvent,
) {
  return {
    error: event.status === "failed" ? event.detail : null,
    status: "RUNNING" as const,
    stepAttempt: event.attempt,
    stepCount: event.stepCount,
    stepDetail: event.detail,
    stepNumber: event.stepNumber,
    stepRetrying: event.retrying,
    stepStatus: event.status,
    stepSummary: event.summary,
  };
}

export function buildTailorResumeTerminalFailureStepEvent(input: {
  detail: string;
  fallbackStepNumber: number;
  fallbackSummary: string;
  previousStepEvent?: TailorResumeGenerationStepEvent | null;
  stepCount?: number | null;
}): TailorResumeGenerationStepEvent {
  const previousStepEvent = input.previousStepEvent ?? null;
  const stepNumber =
    readPositiveInteger(previousStepEvent?.stepNumber) ??
    readPositiveInteger(input.fallbackStepNumber) ??
    1;
  const stepCount =
    readPositiveInteger(previousStepEvent?.stepCount) ??
    readPositiveInteger(input.stepCount) ??
    5;

  return {
    attempt: readPositiveInteger(previousStepEvent?.attempt),
    detail: input.detail,
    durationMs: 0,
    model: previousStepEvent?.model ?? null,
    retrying: false,
    status: "failed",
    stepCount,
    stepNumber,
    summary: previousStepEvent?.summary.trim() || input.fallbackSummary,
  };
}
