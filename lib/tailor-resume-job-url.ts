import type { TailoredResumeRecord } from "./tailor-resume-types.ts";

const jobDescriptionUrlLinePatterns = [
  /^Canonical URL:\s*(\S.+)$/im,
  /^URL:\s*(\S.+)$/im,
];

export function normalizeTailorResumeJobUrl(
  value: string | null | undefined,
) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const url = new URL(trimmedValue);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";

    return url.toString();
  } catch {
    return null;
  }
}

export function readTailorResumeJobUrlFromDescription(jobDescription: string) {
  for (const pattern of jobDescriptionUrlLinePatterns) {
    const match = jobDescription.match(pattern);
    const normalizedUrl = normalizeTailorResumeJobUrl(match?.[1]);

    if (normalizedUrl) {
      return normalizedUrl;
    }
  }

  return null;
}

export function resolveTailorResumeJobUrl(input: {
  explicitJobUrl: unknown;
  jobDescription: string;
}):
  | {
      error: string;
      jobUrl: null;
      ok: false;
    }
  | {
      jobUrl: string | null;
      ok: true;
    } {
  if (typeof input.explicitJobUrl === "string") {
    const trimmedJobUrl = input.explicitJobUrl.trim();

    if (trimmedJobUrl) {
      const normalizedJobUrl = normalizeTailorResumeJobUrl(trimmedJobUrl);

      if (!normalizedJobUrl) {
        return {
          error: "Use a valid http or https job URL.",
          jobUrl: null,
          ok: false,
        };
      }

      return {
        jobUrl: normalizedJobUrl,
        ok: true,
      };
    }
  }

  return {
    jobUrl: readTailorResumeJobUrlFromDescription(input.jobDescription),
    ok: true,
  };
}

export function findTailoredResumeByJobUrl(
  tailoredResumes: TailoredResumeRecord[],
  jobUrl: string | null,
) {
  const normalizedJobUrl = normalizeTailorResumeJobUrl(jobUrl);

  if (!normalizedJobUrl) {
    return null;
  }

  return (
    tailoredResumes.find(
      (record) => normalizeTailorResumeJobUrl(record.jobUrl) === normalizedJobUrl,
    ) ?? null
  );
}

function readComparableTailoredResumeTime(record: TailoredResumeRecord) {
  const updatedAt = Date.parse(record.updatedAt);

  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }

  const createdAt = Date.parse(record.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

export function dedupeTailoredResumesByJobUrl(
  tailoredResumes: TailoredResumeRecord[],
) {
  const recordsByComparableKey = new Map<string, TailoredResumeRecord>();
  const recordsWithoutComparableKey: TailoredResumeRecord[] = [];

  for (const record of tailoredResumes) {
    const applicationId = record.applicationId?.trim();
    const normalizedJobUrl = normalizeTailorResumeJobUrl(record.jobUrl);
    const comparableKey = applicationId
      ? `application:${applicationId}`
      : normalizedJobUrl
        ? `url:${normalizedJobUrl}`
        : null;

    if (!comparableKey) {
      recordsWithoutComparableKey.push(record);
      continue;
    }

    const previousRecord = recordsByComparableKey.get(comparableKey);

    if (
      !previousRecord ||
      readComparableTailoredResumeTime(record) >=
        readComparableTailoredResumeTime(previousRecord)
    ) {
      recordsByComparableKey.set(comparableKey, record);
    }
  }

  return [...recordsByComparableKey.values(), ...recordsWithoutComparableKey].sort(
    (left, right) =>
      readComparableTailoredResumeTime(right) -
      readComparableTailoredResumeTime(left),
  );
}
