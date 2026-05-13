import type {
  TailorResumeExistingTailoringState,
  TailorResumeGenerationSettingsSummary,
  TailoredResumeEmphasizedTechnology,
  TailoredResumeKeywordCoverage,
  TailoredResumeSummary,
} from "./job-helper.ts";
import {
  matchesTailorOverwritePageIdentity,
  resolveCompletedTailoringForPage,
  type TailorOverwritePageIdentity,
} from "./tailor-overwrite-guard.ts";
import { buildCompanyResumeDownloadName } from "../../lib/tailored-resume-download-filename.ts";

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

export function shouldActiveTailoringBlockTailoredResumeTabBadge(
  tailoring: TailorResumeExistingTailoringState | null,
) {
  return Boolean(tailoring && tailoring.kind !== "completed");
}

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
  generationSettings: TailorResumeGenerationSettingsSummary;
  pageIdentity: TailorOverwritePageIdentity;
  tailoredResumes: TailoredResumeSummary[];
}): TailoredResumeTabBadgeSummary | null {
  const blockingActiveTailoring = input.activeTailorings.find((tailoring) =>
    shouldActiveTailoringBlockTailoredResumeTabBadge(tailoring),
  );

  if (blockingActiveTailoring) {
    return null;
  }

  const completedTailoring = resolveCompletedTailoringForPage(input);

  if (!isUsableCompletedTailoring(completedTailoring)) {
    return null;
  }

  const tailoredResume =
    input.tailoredResumes.find(
      (resume) => resume.id === completedTailoring.tailoredResumeId,
    ) ??
    input.tailoredResumes.find(
      (resume) =>
        Boolean(completedTailoring.applicationId) &&
        resume.applicationId === completedTailoring.applicationId,
    ) ??
    input.tailoredResumes.find((resume) =>
      matchesTailorOverwritePageIdentity({
        jobUrl: resume.jobUrl,
        pageIdentity: input.pageIdentity,
      }),
    ) ?? null;
  const emphasizedTechnologies =
    tailoredResume?.emphasizedTechnologies.length
      ? tailoredResume.emphasizedTechnologies
      : completedTailoring.emphasizedTechnologies;

  return {
    badgeKey: `tailored-resume:${completedTailoring.tailoredResumeId}`,
    companyName: completedTailoring.companyName,
    displayName: completedTailoring.displayName,
    downloadName: buildCompanyResumeDownloadName(
      completedTailoring,
      input.generationSettings,
    ),
    emphasizedTechnologies,
    jobUrl: completedTailoring.jobUrl,
    keywordCoverage:
      tailoredResume?.keywordCoverage ?? completedTailoring.keywordCoverage,
    tailoredResumeId: completedTailoring.tailoredResumeId,
  };
}
