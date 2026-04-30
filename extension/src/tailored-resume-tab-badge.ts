import type {
  TailorResumeExistingTailoringState,
  TailoredResumeSummary,
} from "./job-helper.ts";
import {
  resolveCompletedTailoringForPage,
  type TailorOverwritePageIdentity,
} from "./tailor-overwrite-guard.ts";

export type TailoredResumeTabBadgeSummary = {
  badgeKey: string;
  displayName: string;
  jobUrl: string | null;
  tailoredResumeId: string;
};

function isUsableCompletedTailoring(
  tailoring: TailorResumeExistingTailoringState | null,
): tailoring is Extract<TailorResumeExistingTailoringState, { kind: "completed" }> {
  if (!tailoring || tailoring.kind !== "completed") {
    return false;
  }

  if (tailoring.error?.trim()) {
    return false;
  }

  const normalizedStatus = tailoring.status.trim().toLowerCase();
  return (
    !normalizedStatus ||
    normalizedStatus === "complete" ||
    normalizedStatus === "completed" ||
    normalizedStatus === "ready" ||
    normalizedStatus === "success"
  );
}

export function resolveTailoredResumeTabBadge(input: {
  activeTailorings: TailorResumeExistingTailoringState[];
  pageIdentity: TailorOverwritePageIdentity;
  tailoredResumes: TailoredResumeSummary[];
}): TailoredResumeTabBadgeSummary | null {
  const completedTailoring = resolveCompletedTailoringForPage(input);

  if (!isUsableCompletedTailoring(completedTailoring)) {
    return null;
  }

  return {
    badgeKey: `tailored-resume:${completedTailoring.tailoredResumeId}`,
    displayName: completedTailoring.displayName,
    jobUrl: completedTailoring.jobUrl,
    tailoredResumeId: completedTailoring.tailoredResumeId,
  };
}
