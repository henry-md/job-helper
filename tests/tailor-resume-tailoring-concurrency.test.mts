import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyTailorResumeAnnotatedLatexState,
  emptyTailorResumeProfile,
  type TailorResumeLockedLinkRecord,
  type TailoredResumeRecord,
} from "../lib/tailor-resume-types.ts";
import {
  buildTailorResumeGenerationSourceSnapshot,
  hasTailorResumeGenerationSourceChanged,
  mergeTailorResumeFailedGeneration,
  mergeTailorResumeSuccessfulGeneration,
} from "../lib/tailor-resume-tailoring-concurrency.ts";

function buildLockedLinks(
  overrides: Partial<TailorResumeLockedLinkRecord>[] = [],
): TailorResumeLockedLinkRecord[] {
  return overrides.map((override, index) => ({
    key: override.key ?? `locked-${index + 1}`,
    label: override.label ?? `Locked ${index + 1}`,
    updatedAt: override.updatedAt ?? "2026-04-20T12:00:00.000Z",
    url: override.url ?? `https://example.com/${index + 1}`,
  }));
}

function buildTailoredResume(
  overrides: Partial<TailoredResumeRecord>,
): TailoredResumeRecord {
  return {
    annotatedLatexCode: overrides.annotatedLatexCode ?? "% annotated",
    archivedAt: overrides.archivedAt ?? null,
    companyName: overrides.companyName ?? "OpenAI",
    createdAt: overrides.createdAt ?? "2026-04-20T12:00:00.000Z",
    displayName: overrides.displayName ?? "OpenAI - Research Engineer",
    edits: overrides.edits ?? [],
    error: overrides.error ?? null,
    id: overrides.id ?? "tailored-1",
    jobDescription: overrides.jobDescription ?? "Original description",
    jobIdentifier: overrides.jobIdentifier ?? "Research Engineer",
    jobUrl: overrides.jobUrl ?? "https://jobs.example.com/research-engineer",
    latexCode: overrides.latexCode ?? "\\documentclass{article}",
    openAiDebug: overrides.openAiDebug ?? {
      implementation: {
        outputJson: "{}",
        prompt: "impl",
        skippedReason: null,
      },
      planning: {
        outputJson: "{}",
        prompt: "plan",
        skippedReason: null,
      },
    },
    pdfUpdatedAt: overrides.pdfUpdatedAt ?? "2026-04-20T12:00:00.000Z",
    planningResult: overrides.planningResult ?? {
      changes: [],
      companyName: "OpenAI",
      displayName: "OpenAI - Research Engineer",
      jobIdentifier: "Research Engineer",
      positionTitle: "Research Engineer",
      questioningSummary: null,
      thesis: {
        jobDescriptionFocus: "Focus",
        resumeChanges: "Changes",
      },
    },
    positionTitle: overrides.positionTitle ?? "Research Engineer",
    sourceAnnotatedLatexCode: overrides.sourceAnnotatedLatexCode ?? null,
    status: overrides.status ?? "ready",
    thesis: overrides.thesis ?? {
      jobDescriptionFocus: "Focus",
      resumeChanges: "Changes",
    },
    updatedAt: overrides.updatedAt ?? "2026-04-20T12:00:00.000Z",
  };
}

test("tailor generation source snapshot ignores tailored resume list changes", () => {
  const snapshotProfile = {
    ...emptyTailorResumeProfile(),
    jobDescription: "Original description",
    latex: {
      code: "\\documentclass{article}\n\\begin{document}Base\\end{document}",
      error: null,
      pdfUpdatedAt: "2026-04-20T12:00:00.000Z",
      status: "ready" as const,
      updatedAt: "2026-04-20T12:00:00.000Z",
    },
    links: [
      {
        disabled: false,
        key: "portfolio",
        label: "Portfolio",
        locked: false,
        updatedAt: "2026-04-20T12:00:00.000Z",
        url: "https://portfolio.example.com",
      },
    ],
    resume: {
      mimeType: "application/pdf",
      originalFilename: "resume.pdf",
      sizeBytes: 1234,
      storagePath: "/uploads/resumes/user/resume.pdf",
      updatedAt: "2026-04-20T12:00:00.000Z",
    },
    tailoredResumes: [buildTailoredResume({ id: "tailored-existing" })],
  };
  const snapshotLockedLinks = buildLockedLinks([
    {
      key: "linkedin",
      label: "LinkedIn",
      url: "https://linkedin.com/in/example",
    },
  ]);
  const snapshot = buildTailorResumeGenerationSourceSnapshot(
    snapshotProfile,
    snapshotLockedLinks,
  );

  const latestProfile = {
    ...snapshotProfile,
    jobDescription: "Edited description later",
    tailoredResumes: [
      buildTailoredResume({
        displayName: "Renamed resume",
        id: "tailored-existing",
      }),
    ],
  };

  assert.equal(
    hasTailorResumeGenerationSourceChanged({
      currentLockedLinks: snapshotLockedLinks,
      currentRawProfile: latestProfile,
      snapshot,
    }),
    false,
  );

  assert.equal(
    hasTailorResumeGenerationSourceChanged({
      currentLockedLinks: snapshotLockedLinks,
      currentRawProfile: {
        ...latestProfile,
        latex: {
          ...latestProfile.latex,
          code: "\\documentclass{article}\n\\begin{document}Updated\\end{document}",
        },
      },
      snapshot,
    }),
    true,
  );
});

test("mergeTailorResumeSuccessfulGeneration preserves newer job description and deletions", () => {
  const snapshotProfile = {
    ...emptyTailorResumeProfile(),
    jobDescription: "Original description",
    tailoredResumes: [
      buildTailoredResume({
        companyName: "Delete Me Inc.",
        displayName: "Delete Me",
        id: "tailored-deleted",
      }),
      buildTailoredResume({
        companyName: "Keep Me Inc.",
        displayName: "Keep Me",
        id: "tailored-kept",
      }),
    ],
  };
  const currentRawProfile = {
    ...snapshotProfile,
    jobDescription: "Saved newer description",
    tailoredResumes: [
      buildTailoredResume({
        companyName: "Keep Me Inc.",
        displayName: "Renamed kept resume",
        id: "tailored-kept",
      }),
    ],
  };
  const generatedResume = buildTailoredResume({
    companyName: "New Co",
    displayName: "New tailored resume",
    id: "tailored-new",
    jobDescription: "Original description",
  });

  const nextProfile = mergeTailorResumeSuccessfulGeneration({
    annotatedLatex: {
      ...emptyTailorResumeAnnotatedLatexState(),
      code: "% annotated base",
      segmentCount: 4,
      updatedAt: "2026-04-20T12:05:00.000Z",
    },
    currentRawProfile,
    jobDescription: "Original description",
    snapshotRawProfile: snapshotProfile,
    tailoredResume: generatedResume,
  });

  assert.equal(nextProfile.jobDescription, "Saved newer description");
  assert.deepEqual(
    nextProfile.tailoredResumes.map((record) => record.id),
    ["tailored-new", "tailored-kept"],
  );
  assert.equal(nextProfile.tailoredResumes[1]?.displayName, "Renamed kept resume");
  assert.equal(nextProfile.annotatedLatex.code, "% annotated base");
});

test("mergeTailorResumeFailedGeneration only saves the submitted description when it is still current", () => {
  const snapshotProfile = {
    ...emptyTailorResumeProfile(),
    jobDescription: "Original description",
  };

  const savedFailedDescription = mergeTailorResumeFailedGeneration({
    currentRawProfile: snapshotProfile,
    jobDescription: "Description used for failed run",
    snapshotRawProfile: snapshotProfile,
  });

  assert.equal(
    savedFailedDescription.jobDescription,
    "Description used for failed run",
  );

  const preservedNewerDescription = mergeTailorResumeFailedGeneration({
    currentRawProfile: {
      ...snapshotProfile,
      jobDescription: "Saved newer description",
    },
    jobDescription: "Description used for failed run",
    snapshotRawProfile: snapshotProfile,
  });

  assert.equal(
    preservedNewerDescription.jobDescription,
    "Saved newer description",
  );
});
