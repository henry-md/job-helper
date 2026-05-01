import {
  defaultTailorResumeGenerationSettingsSummary,
  readPersonalInfoPayload,
  type PersonalInfoSummary,
} from "./job-helper.ts";
import { type UserSyncStateSnapshot } from "../../lib/sync-state.ts";

export const PERSONAL_INFO_CACHE_STORAGE_KEY = "jobHelperPersonalInfoCache";
const PERSONAL_INFO_CACHE_SCHEMA_VERSION = 3;

export type PersonalInfoCacheEntry = {
  cachedAt: string;
  personalInfo: PersonalInfoSummary;
  schemaVersion: number;
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
    schemaVersion: PERSONAL_INFO_CACHE_SCHEMA_VERSION,
    userId: input.userId,
  } satisfies PersonalInfoCacheEntry;
}

export function readPersonalInfoCacheEntry(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const cachedAt = readString(value.cachedAt);
  const userId = readString(value.userId);
  const schemaVersion =
    typeof value.schemaVersion === "number" && Number.isFinite(value.schemaVersion)
      ? Math.floor(value.schemaVersion)
      : 0;

  if (
    !cachedAt ||
    !userId ||
    schemaVersion !== PERSONAL_INFO_CACHE_SCHEMA_VERSION
  ) {
    return null;
  }

  return {
    cachedAt,
    personalInfo: readPersonalInfoPayload(value.personalInfo),
    schemaVersion,
    userId,
  } satisfies PersonalInfoCacheEntry;
}

export function invalidateChangedPersonalInfoSlices(input: {
  nextSyncState: UserSyncStateSnapshot;
  personalInfo: PersonalInfoSummary;
}) {
  const applicationsChanged =
    input.personalInfo.syncState.applicationsVersion !==
    input.nextSyncState.applicationsVersion;
  const tailoringChanged =
    input.personalInfo.syncState.tailoringVersion !==
    input.nextSyncState.tailoringVersion;

  if (!applicationsChanged && !tailoringChanged) {
    return input.personalInfo;
  }

  return {
    ...input.personalInfo,
    ...(applicationsChanged
      ? {
          applicationCount: 0,
          applications: [],
          companyCount: 0,
        }
      : {}),
    ...(tailoringChanged
      ? {
          activeTailoring: null,
          activeTailorings: [],
          generationSettings: defaultTailorResumeGenerationSettingsSummary,
          tailoredResumes: [],
          tailoringInterview: null,
          tailoringInterviews: [],
        }
      : {}),
  } satisfies PersonalInfoSummary;
}
