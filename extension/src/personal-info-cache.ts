import {
  readPersonalInfoPayload,
  type PersonalInfoSummary,
} from "./job-helper.ts";

export const PERSONAL_INFO_CACHE_STORAGE_KEY = "jobHelperPersonalInfoCache";

export type PersonalInfoCacheEntry = {
  cachedAt: string;
  personalInfo: PersonalInfoSummary;
  userId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildPersonalInfoCacheEntry(input: {
  cachedAt?: string;
  personalInfo: PersonalInfoSummary;
  userId: string;
}) {
  return {
    cachedAt: input.cachedAt ?? new Date().toISOString(),
    personalInfo: input.personalInfo,
    userId: input.userId,
  } satisfies PersonalInfoCacheEntry;
}

export function readPersonalInfoCacheEntry(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const cachedAt = readString(value.cachedAt);
  const userId = readString(value.userId);

  if (!cachedAt || !userId) {
    return null;
  }

  return {
    cachedAt,
    personalInfo: readPersonalInfoPayload(value.personalInfo),
    userId,
  } satisfies PersonalInfoCacheEntry;
}
