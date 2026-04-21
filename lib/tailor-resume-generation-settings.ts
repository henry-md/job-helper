export type TailorResumeGenerationSettings = {
  allowTailorResumeFollowUpQuestions: boolean;
  preventPageCountIncrease: boolean;
};

export function createDefaultTailorResumeGenerationSettings(): TailorResumeGenerationSettings {
  return {
    allowTailorResumeFollowUpQuestions: true,
    preventPageCountIncrease: true,
  };
}

export function mergeTailorResumeGenerationSettings(
  value: unknown,
  fallback: TailorResumeGenerationSettings = createDefaultTailorResumeGenerationSettings(),
): TailorResumeGenerationSettings {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const candidateSettings = value as Partial<
    Record<keyof TailorResumeGenerationSettings, unknown>
  >;

  return {
    allowTailorResumeFollowUpQuestions:
      typeof candidateSettings.allowTailorResumeFollowUpQuestions === "boolean"
        ? candidateSettings.allowTailorResumeFollowUpQuestions
        : fallback.allowTailorResumeFollowUpQuestions,
    preventPageCountIncrease:
      typeof candidateSettings.preventPageCountIncrease === "boolean"
        ? candidateSettings.preventPageCountIncrease
        : fallback.preventPageCountIncrease,
  };
}
