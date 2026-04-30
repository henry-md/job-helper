import { normalizeComparableUrl } from "./job-helper.ts";
import type { TailoredResumeSummary } from "./job-helper.ts";

export type ActiveTailoredResumeReference = {
  applicationId: string | null;
  existingTailoringId: string | null;
  suppressedTailoredResumeId?: string | null;
  url: string | null;
};

function readResumeSortTime(resume: TailoredResumeSummary) {
  const updatedAt = Date.parse(resume.updatedAt);

  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }

  const createdAt = Date.parse(resume.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

export function filterVisibleTailoredResumes(input: {
  activeReferences?: ActiveTailoredResumeReference[];
  resumes: TailoredResumeSummary[];
}) {
  const suppressedResumeIds = new Set(
    (input.activeReferences ?? [])
      .map((reference) => reference.existingTailoringId?.trim() ?? "")
      .filter(Boolean),
  );
  const suppressedApplicationIds = new Set(
    (input.activeReferences ?? [])
      .map((reference) => reference.applicationId?.trim() ?? "")
      .filter(Boolean),
  );
  const suppressedResumeIdsFromActiveRuns = new Set(
    (input.activeReferences ?? [])
      .map((reference) => reference.suppressedTailoredResumeId?.trim() ?? "")
      .filter(Boolean),
  );
  const suppressedComparableUrls = new Set(
    (input.activeReferences ?? [])
      .map((reference) => normalizeComparableUrl(reference.url))
      .filter((value): value is string => Boolean(value)),
  );
  const seenApplicationIds = new Set<string>();
  const seenComparableUrls = new Set<string>();

  return [...input.resumes]
    .sort((left, right) => readResumeSortTime(right) - readResumeSortTime(left))
    .filter((resume) => {
      const applicationId = resume.applicationId?.trim() ?? "";

      if (
        suppressedResumeIds.has(resume.id) ||
        suppressedResumeIdsFromActiveRuns.has(resume.id)
      ) {
        return false;
      }

      if (applicationId && suppressedApplicationIds.has(applicationId)) {
        return false;
      }

      const comparableUrl = normalizeComparableUrl(resume.jobUrl);

      if (comparableUrl && suppressedComparableUrls.has(comparableUrl)) {
        return false;
      }

      if (applicationId) {
        if (seenApplicationIds.has(applicationId)) {
          return false;
        }

        seenApplicationIds.add(applicationId);
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
