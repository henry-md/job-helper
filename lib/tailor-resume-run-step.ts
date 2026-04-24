import type { TailorResumeGenerationStepEvent } from "./tailor-resume-types.ts";

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
