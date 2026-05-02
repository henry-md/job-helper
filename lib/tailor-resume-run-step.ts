import type { TailorResumeGenerationStepEvent } from "./tailor-resume-types.ts";

function readPositiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
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
    retrying: false,
    status: "failed",
    stepCount,
    stepNumber,
    summary: previousStepEvent?.summary.trim() || input.fallbackSummary,
  };
}
