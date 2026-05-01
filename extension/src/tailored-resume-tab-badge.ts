import type {
  TailorResumeExistingTailoringState,
  TailoredResumeEmphasizedTechnology,
  TailoredResumeKeywordCoverage,
  TailoredResumeSummary,
} from "./job-helper.ts";
import {
  resolveCompletedTailoringForPage,
  type TailorOverwritePageIdentity,
} from "./tailor-overwrite-guard.ts";
import { buildCompanyResumeDownloadName } from "./tailored-resume-download-name.ts";

export type TailoredResumeTabBadgeSummary = {
  badgeKey: string;
  companyName: string | null;
  displayName: string;
  downloadName: string;
  emphasizedTechnologies: TailoredResumeEmphasizedTechnology[];
  jobUrl: string | null;
  keywordCoverage: TailoredResumeKeywordCoverage | null;
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

  const tailoredResume =
    input.tailoredResumes.find(
      (resume) => resume.id === completedTailoring.tailoredResumeId,
    ) ?? null;

  return {
    badgeKey: `tailored-resume:${completedTailoring.tailoredResumeId}`,
    companyName: completedTailoring.companyName,
    displayName: completedTailoring.displayName,
    downloadName: buildCompanyResumeDownloadName(completedTailoring),
    emphasizedTechnologies: completedTailoring.emphasizedTechnologies,
    jobUrl: completedTailoring.jobUrl,
    keywordCoverage: tailoredResume?.keywordCoverage ?? null,
    tailoredResumeId: completedTailoring.tailoredResumeId,
  };
}
