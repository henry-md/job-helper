import type {
  TailorResumeAnnotatedLatexState,
  TailorResumeLockedLinkRecord,
  TailorResumeProfile,
  TailoredResumeRecord,
} from "./tailor-resume-types.ts";

export type TailorResumeGenerationSourceSnapshot = {
  latexCode: string;
  linkState: string;
  lockedLinkState: string;
  resumeStoragePath: string | null;
  resumeUpdatedAt: string | null;
};

function serializeGenerationLinks(links: TailorResumeProfile["links"]) {
  return JSON.stringify(
    links.map((link) => ({
      disabled: link.disabled,
      key: link.key,
      label: link.label,
      url: link.url,
    })),
  );
}

function serializeLockedLinks(lockedLinks: TailorResumeLockedLinkRecord[]) {
  return JSON.stringify(
    lockedLinks.map((link) => ({
      key: link.key,
      label: link.label,
      url: link.url,
    })),
  );
}

export function buildTailorResumeGenerationSourceSnapshot(
  rawProfile: TailorResumeProfile,
  lockedLinks: TailorResumeLockedLinkRecord[],
): TailorResumeGenerationSourceSnapshot {
  return {
    latexCode: rawProfile.latex.code,
    linkState: serializeGenerationLinks(rawProfile.links),
    lockedLinkState: serializeLockedLinks(lockedLinks),
    resumeStoragePath: rawProfile.resume?.storagePath ?? null,
    resumeUpdatedAt: rawProfile.resume?.updatedAt ?? null,
  };
}

export function hasTailorResumeGenerationSourceChanged(input: {
  currentLockedLinks: TailorResumeLockedLinkRecord[];
  currentRawProfile: TailorResumeProfile;
  snapshot: TailorResumeGenerationSourceSnapshot;
}) {
  return (
    input.snapshot.latexCode !== input.currentRawProfile.latex.code ||
    input.snapshot.linkState !==
      serializeGenerationLinks(input.currentRawProfile.links) ||
    input.snapshot.lockedLinkState !==
      serializeLockedLinks(input.currentLockedLinks) ||
    input.snapshot.resumeStoragePath !==
      (input.currentRawProfile.resume?.storagePath ?? null) ||
    input.snapshot.resumeUpdatedAt !==
      (input.currentRawProfile.resume?.updatedAt ?? null)
  );
}

export function mergeTailorResumeFailedGeneration(input: {
  currentRawProfile: TailorResumeProfile;
  jobDescription: string;
  snapshotRawProfile: TailorResumeProfile;
}) {
  const currentJobDescription = input.currentRawProfile.jobDescription;

  if (
    currentJobDescription !== input.snapshotRawProfile.jobDescription ||
    currentJobDescription === input.jobDescription
  ) {
    return input.currentRawProfile;
  }

  return {
    ...input.currentRawProfile,
    jobDescription: input.jobDescription,
  };
}

export function mergeTailorResumeSuccessfulGeneration(input: {
  annotatedLatex: TailorResumeAnnotatedLatexState;
  currentRawProfile: TailorResumeProfile;
  jobDescription: string;
  snapshotRawProfile: TailorResumeProfile;
  tailoredResume: TailoredResumeRecord;
}) {
  const shouldUpdateJobDescription =
    input.currentRawProfile.jobDescription ===
    input.snapshotRawProfile.jobDescription;

  return {
    ...input.currentRawProfile,
    annotatedLatex: input.annotatedLatex,
    jobDescription: shouldUpdateJobDescription
      ? input.jobDescription
      : input.currentRawProfile.jobDescription,
    tailoredResumes: [
      input.tailoredResume,
      ...input.currentRawProfile.tailoredResumes.filter(
        (record) => record.id !== input.tailoredResume.id,
      ),
    ],
  };
}
