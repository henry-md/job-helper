import type { TailoredResumeRecord } from "./tailor-resume-types.ts";

const jobDescriptionUrlLinePatterns = [
  /^Canonical URL:\s*(\S.+)$/im,
  /^URL:\s*(\S.+)$/im,
];
const comparableQueryParamAllowlist = new Set([
  "gh_jid",
  "jid",
  "job_id",
  "jobid",
  "jk",
  "pid",
  "req_id",
  "reqid",
]);

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
    const comparableQueryEntries = [...url.searchParams.entries()]
      .map(([key, entryValue]) => [key.toLowerCase(), entryValue.trim()] as const)
      .filter(
        ([key, entryValue]) =>
          entryValue.length > 0 &&
          comparableQueryParamAllowlist.has(key),
      )
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey === rightKey
          ? leftValue.localeCompare(rightValue)
          : leftKey.localeCompare(rightKey),
      );
    const comparableSearchParams = new URLSearchParams();

    for (const [key, entryValue] of comparableQueryEntries) {
      comparableSearchParams.append(key, entryValue);
    }

    url.search = comparableSearchParams.toString()
      ? `?${comparableSearchParams.toString()}`
      : "";

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
