export const defaultRetryAttemptsToGenerateLatexFromPdf = 3;
export const defaultRetryAttemptsToGenerateLatexEdits = 3;
export const defaultRetryAttemptsToGeneratePageCountCompaction = 5;
export const defaultRetryAttemptsForTransientModelErrors = 3;

function parseRetryAttemptCount(
  value: string | undefined,
  fallback: number,
) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(normalizedValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return parsedValue;
}

export function getRetryAttemptsToGenerateLatexFromPdf() {
  return parseRetryAttemptCount(
    process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_FROM_PDF,
    defaultRetryAttemptsToGenerateLatexFromPdf,
  );
}

export function getRetryAttemptsToGenerateLatexEdits() {
  return parseRetryAttemptCount(
    process.env.RETRY_ATTEMPTS_TO_GENERATE_LATEX_EDITS,
    defaultRetryAttemptsToGenerateLatexEdits,
  );
}

export function getRetryAttemptsToGeneratePageCountCompaction() {
  return parseRetryAttemptCount(
    process.env.RETRY_ATTEMPTS_TO_GENERATE_PAGE_COUNT_COMPACTION,
    defaultRetryAttemptsToGeneratePageCountCompaction,
  );
}

export function getRetryAttemptsForTransientModelErrors() {
  return parseRetryAttemptCount(
    process.env.RETRY_ATTEMPTS_FOR_TRANSIENT_MODEL_ERRORS,
    defaultRetryAttemptsForTransientModelErrors,
  );
}
