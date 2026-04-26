type TailoredResumeFailureInput = {
  error?: string | null;
  status?: string | null;
};

export function hasTailoredResumeGenerationFailure(
  input: TailoredResumeFailureInput,
) {
  return Boolean(input.error?.trim()) || input.status === "failed";
}

export function getTailoredResumeGenerationFailureLabel(
  input: TailoredResumeFailureInput,
) {
  if (input.error?.trim()) {
    return "Failed generation";
  }

  if (input.status === "failed") {
    return "Preview failed";
  }

  return null;
}
