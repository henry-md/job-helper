export const tailorResumeGenerationSettingKeys = [
  "allowTailorResumeFollowUpQuestions",
  "customResumeDownloadName",
  "includeLowPriorityTermsInKeywordCoverage",
  "ludicrousMode",
  "preventPageCountIncrease",
  "useCustomResumeDownloadName",
] as const;

export const currentTailorResumeGenerationSettingsVersion = 4;

export type TailorResumeGenerationSettings = {
  allowTailorResumeFollowUpQuestions: boolean;
  customResumeDownloadName: string;
  includeLowPriorityTermsInKeywordCoverage: boolean;
  ludicrousMode: boolean;
  preventPageCountIncrease: boolean;
  useCustomResumeDownloadName: boolean;
};

export function createDefaultTailorResumeGenerationSettings(): TailorResumeGenerationSettings {
  return {
    allowTailorResumeFollowUpQuestions: true,
    customResumeDownloadName: "Resume",
    includeLowPriorityTermsInKeywordCoverage: false,
    ludicrousMode: false,
    preventPageCountIncrease: true,
    useCustomResumeDownloadName: false,
  };
}

export function mergeTailorResumeGenerationSettings(
  value: unknown,
  fallback: TailorResumeGenerationSettings = createDefaultTailorResumeGenerationSettings(),
): TailorResumeGenerationSettings {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const candidateSettings = value as Partial<Record<keyof TailorResumeGenerationSettings, unknown>>;
  const nextSettings = { ...fallback };

  for (const key of tailorResumeGenerationSettingKeys.filter(
    (settingKey) => settingKey !== "customResumeDownloadName",
  )) {
    if (typeof candidateSettings[key] === "boolean") {
      nextSettings[key] = candidateSettings[key];
    }
  }

  if (typeof candidateSettings.customResumeDownloadName === "string") {
    nextSettings.customResumeDownloadName =
      candidateSettings.customResumeDownloadName.trim().slice(0, 160) ||
      fallback.customResumeDownloadName;
  }

  return nextSettings;
}
