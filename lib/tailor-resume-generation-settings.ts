export const tailorResumeGenerationSettingKeys = [
  "allowTailorResumeFollowUpQuestions",
  "preventPageCountIncrease",
] as const;

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
