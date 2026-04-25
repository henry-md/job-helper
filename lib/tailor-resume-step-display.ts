type TailorResumeRetrySourceStatus =
  | "failed"
  | "running"
  | "skipped"
  | "succeeded";

export type TailorResumeProgressDisplayStatus =
  | "current"
  | "failed"
  | "pending"
  | "retrying"
  | "skipped"
  | "succeeded";

type TailorResumeRetryDisplayInput = {
  attempt: number | null | undefined;
  retrying?: boolean | null;
  status?: TailorResumeRetrySourceStatus | null;
};

type TailorResumeLiveStatusStep = TailorResumeRetryDisplayInput & {
  stepCount: number;
  stepNumber: number;
  summary: string;
};

function normalizeTailorResumeAttempt(attempt: number | null | undefined) {
  if (
    typeof attempt !== "number" ||
    !Number.isFinite(attempt) ||
    attempt < 1
  ) {
    return null;
  }

  return Math.floor(attempt);
}

export function readTailorResumeDisplayAttempt(
  input: TailorResumeRetryDisplayInput,
) {
  const normalizedAttempt = normalizeTailorResumeAttempt(input.attempt);

  if (normalizedAttempt === null) {
    return null;
  }

  if (input.retrying && input.status === "failed") {
    return normalizedAttempt + 1;
  }

  return normalizedAttempt;
}

export function formatTailorResumeRetryLabel(
  attempt: number | null | undefined,
) {
  const normalizedAttempt = normalizeTailorResumeAttempt(attempt);

  return normalizedAttempt === null
    ? "Retrying"
    : `Retrying (attempt ${String(normalizedAttempt)})`;
}

export function formatTailorResumeProgressStatusLabel(input: {
  attempt: number | null | undefined;
  status: TailorResumeProgressDisplayStatus;
}) {
  switch (input.status) {
    case "current":
      return "Running";
    case "failed":
      return "Failed";
    case "retrying":
      return formatTailorResumeRetryLabel(input.attempt);
    case "skipped":
      return "Skipped";
    case "succeeded":
      return "Done";
    case "pending":
    default:
      return "Waiting";
  }
}

export function formatTailorResumeProgressStepLabel(input: {
  label: string;
  status: TailorResumeProgressDisplayStatus;
}) {
  return input.status === "current" || input.status === "retrying"
    ? `${input.label}...`
    : input.label;
}

export function readTailorResumeProgressAttemptBadgeLabel(input: {
  attempt: number | null | undefined;
  status: TailorResumeProgressDisplayStatus;
}) {
  const normalizedAttempt = normalizeTailorResumeAttempt(input.attempt);

  if (
    (input.status === "current" || input.status === "retrying") &&
    normalizedAttempt !== null &&
    normalizedAttempt > 1
  ) {
    return `Attempt ${String(normalizedAttempt)}`;
  }

  return null;
}

export function buildTailorResumeLiveStatusMessage(
  step: TailorResumeLiveStatusStep | null,
  fallback = "Tailoring your resume for this job...",
) {
  if (!step) {
    return fallback;
  }

  const displayAttempt = readTailorResumeDisplayAttempt(step);

  if (step.retrying) {
    return (
      `Stage ${String(step.stepNumber)}/${String(step.stepCount)}: ${step.summary} - ` +
      formatTailorResumeRetryLabel(displayAttempt)
    );
  }

  const attemptLabel =
    displayAttempt === null ? "" : ` (attempt ${String(displayAttempt)})`;

  return `Stage ${String(step.stepNumber)}/${String(step.stepCount)}: ${step.summary}${attemptLabel}`;
}
