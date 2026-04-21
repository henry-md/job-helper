export type TailorResumeGenerationSettings = {
  preventPageCountIncrease: boolean;
};

export function createDefaultTailorResumeGenerationSettings(): TailorResumeGenerationSettings {
  return {
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
    preventPageCountIncrease:
      typeof candidateSettings.preventPageCountIncrease === "boolean"
        ? candidateSettings.preventPageCountIncrease
        : fallback.preventPageCountIncrease,
  };
}
