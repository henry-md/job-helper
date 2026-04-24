export function formatTailorResumeStepError(
  stepNumber: number,
  detail: string | null | undefined,
) {
  const normalizedDetail = detail?.trim() ?? "";

  if (!normalizedDetail) {
    return `Step ${stepNumber}: Unknown error.`;
  }

  if (/^step\s+\d+\s*:/i.test(normalizedDetail)) {
    return normalizedDetail;
  }

  return `Step ${stepNumber}: ${normalizedDetail}`;
}

export function buildTailorResumeAttemptFailureMessage(input: {
  attempts: number;
  stepNumber: number;
  validationError: string | null | undefined;
}) {
  const attemptLabel = input.attempts === 1 ? "attempt" : "attempts";
  const validationError = input.validationError?.trim()
    ? formatTailorResumeStepError(input.stepNumber, input.validationError)
    : null;

  if (validationError) {
    return `Unable to generate a valid tailored resume after ${input.attempts} ${attemptLabel}: ${validationError}`;
  }

  return `Unable to generate a valid tailored resume after ${input.attempts} ${attemptLabel}.`;
}
