import type { TailorResumeProfile } from "./tailor-resume-types.ts";

export const STALE_ACTIVE_TAILOR_RESUME_RUN_MAX_AGE_MS = 1000 * 60 * 5;
const TERMINAL_ACTIVE_TAILOR_RESUME_RUN_GRACE_MS = 1000 * 45;

export function isInvalidTailoredResumeArtifact(
  record: Pick<TailorResumeProfile["tailoredResumes"][number], "edits" | "pdfUpdatedAt">,
) {
  return !record.pdfUpdatedAt && record.edits.length === 0;
}

export function shouldDeleteActiveTailorResumeRun(input: {
  hasMatchingInterview: boolean;
  matchingInterviewStatus?: string | null;
  now?: number;
  status: string;
  stepStatus: string | null;
  updatedAt: Date | string;
}) {
  const updatedAtMs =
    input.updatedAt instanceof Date
      ? input.updatedAt.getTime()
      : Date.parse(input.updatedAt);
  const now = input.now ?? Date.now();
  const ageMs = Number.isFinite(updatedAtMs)
    ? Math.max(0, now - updatedAtMs)
    : Number.POSITIVE_INFINITY;

  if (input.status === "NEEDS_INPUT") {
    return !input.hasMatchingInterview;
  }

  if (input.status !== "RUNNING") {
    return false;
  }

  const normalizedInterviewStatus =
    input.matchingInterviewStatus?.trim().toLowerCase() ?? null;

  if (
    normalizedInterviewStatus === "queued" ||
    normalizedInterviewStatus === "deciding" ||
    normalizedInterviewStatus === "ready"
  ) {
    return false;
  }

  const normalizedStepStatus = input.stepStatus?.trim().toLowerCase() ?? null;

  if (
    normalizedStepStatus &&
    normalizedStepStatus !== "running" &&
    ageMs >= TERMINAL_ACTIVE_TAILOR_RESUME_RUN_GRACE_MS
  ) {
    return true;
  }

  return ageMs >= STALE_ACTIVE_TAILOR_RESUME_RUN_MAX_AGE_MS;
}
