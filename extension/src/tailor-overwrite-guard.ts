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
