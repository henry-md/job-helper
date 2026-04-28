import type {
  PersonalInfoSummary,
  TailorResumeExistingTailoringState,
  TailoredResumeSummary,
} from "./job-helper.ts";
import { normalizeComparableUrl } from "./comparable-job-url.ts";

export type TailorOverwritePageIdentity = {
  canonicalUrl: string | null;
  jobUrl: string | null;
  pageUrl: string | null;
};

export function matchesTailorOverwritePageIdentity(input: {
  jobUrl: string | null;
  pageIdentity: TailorOverwritePageIdentity;
}) {
  const normalizedJobUrl = normalizeComparableUrl(input.jobUrl);

  if (!normalizedJobUrl) {
    return false;
  }

  return [
    input.pageIdentity.pageUrl,
    input.pageIdentity.canonicalUrl,
    input.pageIdentity.jobUrl,
  ]
    .map(normalizeComparableUrl)
    .some((candidate) => candidate === normalizedJobUrl);
}

function buildCompletedExistingTailoringState(
  tailoredResume: TailoredResumeSummary,
): TailorResumeExistingTailoringState {
  return {
    companyName: tailoredResume.companyName,
    createdAt: tailoredResume.createdAt,
    displayName: tailoredResume.displayName,
    error: null,
    id: tailoredResume.id,
    jobIdentifier: tailoredResume.jobIdentifier,
    jobUrl: tailoredResume.jobUrl,
    kind: "completed",
    positionTitle: tailoredResume.positionTitle,
    status: tailoredResume.status ?? "ready",
    tailoredResumeId: tailoredResume.id,
    updatedAt: tailoredResume.updatedAt,
  };
}

export function resolvePotentialTailorOverwrite(input: {
  activeTailorings: TailorResumeExistingTailoringState[];
  pageIdentity: TailorOverwritePageIdentity;
  tailoredResumes: TailoredResumeSummary[];
}) {
  const matchingActiveTailoring =
    input.activeTailorings.find((activeTailoring) =>
      matchesTailorOverwritePageIdentity({
        jobUrl: activeTailoring.jobUrl,
        pageIdentity: input.pageIdentity,
      }),
    ) ?? null;

  if (matchingActiveTailoring) {
    return matchingActiveTailoring;
  }

  const matchingTailoredResume =
    input.tailoredResumes.find((tailoredResume) =>
      matchesTailorOverwritePageIdentity({
        jobUrl: tailoredResume.jobUrl,
        pageIdentity: input.pageIdentity,
      }),
    ) ?? null;

  return matchingTailoredResume
    ? buildCompletedExistingTailoringState(matchingTailoredResume)
    : null;
}

export function resolvePotentialTailorOverwriteFromPersonalInfo(input: {
  pageIdentity: TailorOverwritePageIdentity;
  personalInfo:
    | Pick<PersonalInfoSummary, "activeTailorings" | "tailoredResumes">
    | null;
}) {
  if (!input.personalInfo) {
    return null;
  }

  return resolvePotentialTailorOverwrite({
    activeTailorings: input.personalInfo.activeTailorings,
    pageIdentity: input.pageIdentity,
    tailoredResumes: input.personalInfo.tailoredResumes,
  });
}

export function resolveCompletedTailoringForPage(input: {
  activeTailorings: TailorResumeExistingTailoringState[];
  pageIdentity: TailorOverwritePageIdentity;
  tailoredResumes: TailoredResumeSummary[];
}) {
  const matchedTailoring = resolvePotentialTailorOverwrite(input);

  return matchedTailoring?.kind === "completed" ? matchedTailoring : null;
}

export function resolveActiveTailoringForPage(input: {
  activeTailorings: TailorResumeExistingTailoringState[];
  pageIdentity: TailorOverwritePageIdentity;
}) {
  return (
    input.activeTailorings.find((activeTailoring) =>
      matchesTailorOverwritePageIdentity({
        jobUrl: activeTailoring.jobUrl,
        pageIdentity: input.pageIdentity,
      }),
    ) ?? null
  );
}
