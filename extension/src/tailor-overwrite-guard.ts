import type {
  TailorResumeExistingTailoringState,
  TailoredResumeSummary,
} from "./job-helper";

export type TailorOverwritePageIdentity = {
  canonicalUrl: string | null;
  jobUrl: string | null;
  pageUrl: string | null;
};

function normalizeComparableUrl(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    parsedUrl.hash = "";
    parsedUrl.search = "";

    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      parsedUrl.protocol = "https:";
    }

    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    return parsedUrl.toString();
  } catch {
    return trimmedValue;
  }
}

function matchesPageIdentity(input: {
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
  activeTailoring: TailorResumeExistingTailoringState | null;
  pageIdentity: TailorOverwritePageIdentity;
  tailoredResumes: TailoredResumeSummary[];
}) {
  if (
    input.activeTailoring &&
    matchesPageIdentity({
      jobUrl: input.activeTailoring.jobUrl,
      pageIdentity: input.pageIdentity,
    })
  ) {
    return input.activeTailoring;
  }

  const matchingTailoredResume =
    input.tailoredResumes.find((tailoredResume) =>
      matchesPageIdentity({
        jobUrl: tailoredResume.jobUrl,
        pageIdentity: input.pageIdentity,
      }),
    ) ?? null;

  return matchingTailoredResume
    ? buildCompletedExistingTailoringState(matchingTailoredResume)
    : null;
}
