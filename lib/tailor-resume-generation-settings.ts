export const tailorResumeGenerationSettingKeys = [
  "allowTailorResumeFollowUpQuestions",
  "customResumeDownloadName",
  "includeLowPriorityTermsInKeywordCoverage",
  "ludicrousMode",
  "masterChatModel",
  "preventPageCountIncrease",
  "step1Model",
  "step3Model",
  "step4Model",
  "step4bModel",
  "useCustomResumeDownloadName",
] as const;

export const currentTailorResumeGenerationSettingsVersion = 7;

export const defaultTailorResumeModelSettings = {
  masterChatModel: "gpt-5.4",
  step1Model: "gpt-5.4-mini",
  step3Model: "anthropic:claude-sonnet-4-6",
  step4Model: "gpt-5.5",
  step4bModel: "gpt-5.4",
} as const;

export const tailorResumeModelSettingKeys = [
  "masterChatModel",
  "step1Model",
  "step3Model",
  "step4Model",
  "step4bModel",
] as const;

export const tailorResumeSelectableModelValues = [
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5-mini",
  "gpt-5",
  "anthropic:claude-sonnet-4-6",
  "anthropic:claude-opus-4-6",
  "anthropic:claude-haiku-4-5",
  "anthropic:claude-sonnet-4",
] as const;

export type TailorResumeSelectableModel =
  (typeof tailorResumeSelectableModelValues)[number];

export type TailorResumeGenerationSettings = {
  allowTailorResumeFollowUpQuestions: boolean;
  customResumeDownloadName: string;
  includeLowPriorityTermsInKeywordCoverage: boolean;
  ludicrousMode: boolean;
  masterChatModel: TailorResumeSelectableModel;
  preventPageCountIncrease: boolean;
  step1Model: TailorResumeSelectableModel;
  step3Model: TailorResumeSelectableModel;
  step4Model: TailorResumeSelectableModel;
  step4bModel: TailorResumeSelectableModel;
  useCustomResumeDownloadName: boolean;
};

export function createDefaultTailorResumeGenerationSettings(): TailorResumeGenerationSettings {
  return {
    allowTailorResumeFollowUpQuestions: true,
    customResumeDownloadName: "Resume",
    includeLowPriorityTermsInKeywordCoverage: false,
    ludicrousMode: true,
    masterChatModel: defaultTailorResumeModelSettings.masterChatModel,
    preventPageCountIncrease: true,
    step1Model: defaultTailorResumeModelSettings.step1Model,
    step3Model: defaultTailorResumeModelSettings.step3Model,
    step4Model: defaultTailorResumeModelSettings.step4Model,
    step4bModel: defaultTailorResumeModelSettings.step4bModel,
    useCustomResumeDownloadName: false,
  };
}

export function isTailorResumeSelectableModel(
  value: unknown,
): value is TailorResumeSelectableModel {
  return (
    typeof value === "string" &&
    tailorResumeSelectableModelValues.includes(
      value as TailorResumeSelectableModel,
    )
  );
}

export function resolveTailorResumeSelectableModel(value: string) {
  return value;
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

  const booleanSettingKeys = tailorResumeGenerationSettingKeys.filter(
    (settingKey) =>
      settingKey !== "customResumeDownloadName" &&
      !tailorResumeModelSettingKeys.includes(
        settingKey as (typeof tailorResumeModelSettingKeys)[number],
      ),
  ) as Array<
    Exclude<
      keyof TailorResumeGenerationSettings,
      "customResumeDownloadName" | (typeof tailorResumeModelSettingKeys)[number]
    >
  >;

  for (const key of booleanSettingKeys) {
    if (typeof candidateSettings[key] === "boolean") {
      nextSettings[key] = candidateSettings[key];
    }
  }

  for (const key of tailorResumeModelSettingKeys) {
    if (isTailorResumeSelectableModel(candidateSettings[key])) {
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
