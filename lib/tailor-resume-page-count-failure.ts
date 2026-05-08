import type { GenerateTailoredResumeResult } from "./tailor-resume-tailoring.ts";
import { formatTailorResumeStepError } from "./tailor-resume-step-error.ts";

export function applyTailorResumePageCountFailure(
  result: GenerateTailoredResumeResult,
  errorMessage: string,
): GenerateTailoredResumeResult {
  const normalizedError = formatTailorResumeStepError(4, errorMessage);

  return {
    ...result,
    outcome: "generation_failure",
    validationError: normalizedError,
  };
}
