import {
  readPersonalInfoPayload,
  type PersonalInfoSummary,
} from "./job-helper.ts";
import { type UserSyncStateSnapshot } from "../../lib/sync-state.ts";

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
          tailoredResumes: [],
          tailoringInterview: null,
          tailoringInterviews: [],
        }
      : {}),
  } satisfies PersonalInfoSummary;
}
