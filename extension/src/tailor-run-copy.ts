const sameLineCountWarning =
  "No proposed compaction candidate reduced its block's measured rendered line count.";
const pageCountComparisonWarning =
  "Unable to compare the tailored resume page count.";

function normalizeTailoringWarning(value: string) {
  return value.replace(/^Step 5:\s*/i, "").trim();
}

function buildTailoringWarningMessage(input: {
  jobLabel: string;
  tailoredResumeError: string;
}) {
  const normalizedError = normalizeTailoringWarning(input.tailoredResumeError);

  if (!normalizedError) {
    return `Saved a tailored draft for ${input.jobLabel}, but it still needs review.`;
  }

  if (normalizedError === sameLineCountWarning) {
    return `Saved a tailored draft for ${input.jobLabel}, but Step 5 couldn't reduce the page size.`;
  }

  if (normalizedError === pageCountComparisonWarning) {
    return `Saved a tailored draft for ${input.jobLabel}, but Step 5 couldn't compare the page size.`;
  }

  return `Saved a tailored draft for ${input.jobLabel}, but it still needs review: ${normalizedError}`;
}

export function buildCompletedTailoringMessage(input: {
  alreadyTailored?: boolean;
  jobLabel: string;
  tailoredResumeError?: string | null;
}) {
  const tailoredResumeError = input.tailoredResumeError?.trim() || null;

  if (input.alreadyTailored) {
    return `Already tailored ${input.jobLabel}.`;
  }

  if (tailoredResumeError) {
    return buildTailoringWarningMessage({
      jobLabel: input.jobLabel,
      tailoredResumeError,
    });
  }

  return `Tailored resume for ${input.jobLabel} is ready.`;
}
