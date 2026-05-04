import { normalizeComparableUrl } from "./comparable-job-url.ts";

export const KEYWORD_BADGE_DISMISSAL_STORAGE_KEY =
  "jobHelperDismissedKeywordBadges";

export function deriveKeywordBadgeDismissalKey(input: {
  badgeKey?: string | null;
  jobUrl?: string | null;
  tailoredResumeId?: string | null;
}): string | null {
  const normalizedJobUrl = normalizeComparableUrl(input.jobUrl ?? null);
  if (normalizedJobUrl) {
    return `job-url:${normalizedJobUrl}`;
  }

  const tailoredResumeId = input.tailoredResumeId?.trim();
  if (tailoredResumeId) {
    return `tailored-resume:${tailoredResumeId}`;
  }

  const badgeKey = input.badgeKey?.trim();
  if (badgeKey) {
    return `badge:${badgeKey}`;
  }

  return null;
}

export function readDismissedKeywordBadgeMap(value: unknown) {
  const result = new Set<string>();

  if (!value || typeof value !== "object") {
    return result;
  }

  for (const [key, dismissed] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (dismissed === true && typeof key === "string" && key) {
      result.add(key);
    }
  }

  return result;
}
