export const tailorResumeGenerationSettingKeys = [
  "allowTailorResumeFollowUpQuestions",
  "includeLowPriorityTermsInKeywordCoverage",
  "preventPageCountIncrease",
] as const;

export const currentTailorResumeGenerationSettingsVersion = 2;

export type TailorResumeGenerationSettings = {
  allowTailorResumeFollowUpQuestions: boolean;
  includeLowPriorityTermsInKeywordCoverage: boolean;
  preventPageCountIncrease: boolean;
};

export function createDefaultTailorResumeGenerationSettings(): TailorResumeGenerationSettings {
  return {
    allowTailorResumeFollowUpQuestions: true,
    includeLowPriorityTermsInKeywordCoverage: false,
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
    Record<(typeof tailorResumeGenerationSettingKeys)[number], unknown>
  >;
  const nextSettings = { ...fallback };

  for (const key of tailorResumeGenerationSettingKeys) {
    if (typeof candidateSettings[key] === "boolean") {
      nextSettings[key] = candidateSettings[key];
    }
  }

  return nextSettings;
}
