import { normalizeComparableUrl } from "./job-helper.ts";
import type { TailoredResumeSummary } from "./job-helper.ts";

export type ActiveTailoredResumeReference = {
  existingTailoringId: string | null;
  url: string | null;
};

export function filterVisibleTailoredResumes(input: {
  activeReferences?: ActiveTailoredResumeReference[];
  resumes: TailoredResumeSummary[];
}) {
  const suppressedResumeIds = new Set(
    (input.activeReferences ?? [])
      .map((reference) => reference.existingTailoringId?.trim() ?? "")
      .filter(Boolean),
  );
  const suppressedComparableUrls = new Set(
    (input.activeReferences ?? [])
      .map((reference) => normalizeComparableUrl(reference.url))
      .filter((value): value is string => Boolean(value)),
  );
  const seenComparableUrls = new Set<string>();

  return input.resumes.filter((resume) => {
    if (suppressedResumeIds.has(resume.id)) {
      return false;
    }

    const comparableUrl = normalizeComparableUrl(resume.jobUrl);

    if (comparableUrl && suppressedComparableUrls.has(comparableUrl)) {
      return false;
    }

    if (!comparableUrl) {
      return true;
    }

    if (seenComparableUrls.has(comparableUrl)) {
      return false;
    }

    seenComparableUrls.add(comparableUrl);
    return true;
  });
}
