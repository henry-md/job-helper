import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyResumeDownloadName } from "../lib/tailored-resume-download-filename.ts";
import {
  resolveTailoredResumeTabBadge,
  shouldActiveTailoringBlockTailoredResumeTabBadge,
} from "../extension/src/tailored-resume-tab-badge.ts";
import type {
  TailorResumeExistingTailoringState,
  TailoredResumeKeywordCoverage,
  TailoredResumeSummary,
} from "../extension/src/job-helper.ts";

const matchingJobUrl = "https://jobs.example.com/roles/123?posting=abc";

function buildPageIdentity(
  overrides: Partial<{
    canonicalUrl: string | null;
    jobUrl: string | null;
    pageUrl: string | null;
  }> = {},
) {
  return {
    canonicalUrl: matchingJobUrl,
    jobUrl: matchingJobUrl,
    pageUrl: `${matchingJobUrl}#overview`,
    ...overrides,
  };
}

function buildTailoredResumeSummary(
  overrides: Partial<TailoredResumeSummary> = {},
): TailoredResumeSummary {
  return {
    applicationId: "app-123",
    archivedAt: null,
    companyName: "Example Corp",
    createdAt: "2026-04-25T15:10:00.000Z",
    displayName: "Example Corp - Software Engineer",
    emphasizedTechnologies: [
      {
        evidence: "Required section lists TypeScript.",
        name: "TypeScript",
        priority: "high",
      },
    ],
    id: "tailored-123",
    jobIdentifier: "Software Engineer",
    jobUrl: matchingJobUrl,
    keywordCoverage: null,
    positionTitle: "Software Engineer",
    status: "ready",
    updatedAt: "2026-04-25T15:10:00.000Z",
    ...overrides,
  };
}

function buildKeywordCoverage(): TailoredResumeKeywordCoverage {
  const terms = [
    {
      name: "TypeScript",
      presentInOriginal: true,
      presentInTailored: true,
      priority: "high" as const,
    },
    {
      name: "Kubernetes",
      presentInOriginal: false,
      presentInTailored: true,
      priority: "high" as const,
    },
  ];

  return {
    allPriorities: {
      addedTerms: ["Kubernetes"],
      matchedOriginalTerms: ["TypeScript"],
      matchedTailoredTerms: ["TypeScript", "Kubernetes"],
      originalHitCount: 1,
      originalHitPercentage: 50,
      tailoredHitCount: 2,
      tailoredHitPercentage: 100,
      terms,
      totalTermCount: 2,
    },
    highPriority: {
      addedTerms: ["Kubernetes"],
      matchedOriginalTerms: ["TypeScript"],
      matchedTailoredTerms: ["TypeScript", "Kubernetes"],
      originalHitCount: 1,
      originalHitPercentage: 50,
      tailoredHitCount: 2,
      tailoredHitPercentage: 100,
      terms,
      totalTermCount: 2,
    },
    matcherVersion: 1,
    updatedAt: "2026-05-09T16:00:00.000Z",
  };
}

function buildActiveTailoring(
  overrides: Partial<
    Extract<TailorResumeExistingTailoringState, { kind: "active_generation" }>
  > = {},
): Extract<TailorResumeExistingTailoringState, { kind: "active_generation" }> {
  return {
    applicationId: "app-123",
    companyName: "Example Corp",
    createdAt: "2026-04-25T15:00:00.000Z",
    generationStepTimings: [],
    id: "run-123",
    jobDescription: "Role text",
    jobIdentifier: "Software Engineer",
    jobUrl: matchingJobUrl,
    kind: "active_generation",
    lastStep: null,
    positionTitle: "Software Engineer",
    updatedAt: "2026-04-25T15:05:00.000Z",
    ...overrides,
  };
}

function buildCompletedTailoring(
  overrides: Partial<
    Extract<TailorResumeExistingTailoringState, { kind: "completed" }>
  > = {},
): Extract<TailorResumeExistingTailoringState, { kind: "completed" }> {
  return {
    applicationId: "app-123",
    companyName: "Example Corp",
    createdAt: "2026-04-25T15:00:00.000Z",
    displayName: "Example Corp - Software Engineer",
    emphasizedTechnologies: [],
    error: null,
    generationStepTimings: [],
    id: "db-tailored-123",
    jobIdentifier: "Software Engineer",
    jobUrl: matchingJobUrl,
    keywordCoverage: null,
    kind: "completed",
    positionTitle: "Software Engineer",
    status: "ready",
    tailoredResumeId: "tailored-123",
    updatedAt: "2026-04-25T15:10:00.000Z",
    ...overrides,
  };
}

test("returns a tab badge for a completed tailored resume matching the page URL", () => {
  const keywordCoverage = buildKeywordCoverage();
  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: [],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary({ keywordCoverage })],
  });

  assert.deepEqual(badge, {
    badgeKey: "tailored-resume:tailored-123",
    companyName: "Example Corp",
    displayName: "Example Corp - Software Engineer",
    downloadName: "Example Corp.pdf",
    emphasizedTechnologies: [
      {
        evidence: "Required section lists TypeScript.",
        name: "TypeScript",
        priority: "high",
      },
    ],
    jobUrl: matchingJobUrl,
    keywordCoverage,
    tailoredResumeId: "tailored-123",
  });
});

test("does not return a tab badge when the page query differs", () => {
  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: [],
    pageIdentity: buildPageIdentity({
      canonicalUrl: "https://jobs.example.com/roles/123?posting=other",
      jobUrl: "https://jobs.example.com/roles/123?posting=other",
      pageUrl: "https://jobs.example.com/roles/123?posting=other",
    }),
    tailoredResumes: [buildTailoredResumeSummary()],
  });

  assert.equal(badge, null);
});

test("does not show the generated-resume badge while a matching run is active", () => {
  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: [buildActiveTailoring()],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary()],
  });

  assert.equal(badge, null);
});

test("completed tailorings do not block finished resume keyword coverage badges", () => {
  assert.equal(
    shouldActiveTailoringBlockTailoredResumeTabBadge(buildCompletedTailoring()),
    false,
  );
  assert.equal(
    shouldActiveTailoringBlockTailoredResumeTabBadge(buildActiveTailoring()),
    true,
  );
});

test("uses the saved resume keywords and coverage for completed tailoring badges", () => {
  const keywordCoverage = buildKeywordCoverage();
  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: [buildCompletedTailoring()],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary({ keywordCoverage })],
  });

  assert.equal(badge?.tailoredResumeId, "tailored-123");
  assert.equal(badge?.keywordCoverage, keywordCoverage);
  assert.deepEqual(badge?.emphasizedTechnologies, [
    {
      evidence: "Required section lists TypeScript.",
      name: "TypeScript",
      priority: "high",
    },
  ]);
});

test("falls back to completed tailoring keyword coverage before the saved resume list catches up", () => {
  const keywordCoverage = buildKeywordCoverage();
  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: [
      buildCompletedTailoring({
        emphasizedTechnologies: [
          {
            evidence: "Required section lists TypeScript.",
            name: "TypeScript",
            priority: "high",
          },
        ],
        keywordCoverage,
      }),
    ],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [],
  });

  assert.equal(badge?.tailoredResumeId, "tailored-123");
  assert.equal(badge?.keywordCoverage, keywordCoverage);
  assert.deepEqual(badge?.emphasizedTechnologies, [
    {
      evidence: "Required section lists TypeScript.",
      name: "TypeScript",
      priority: "high",
    },
  ]);
});

test("matches saved resume coverage by job URL when the completed id is stale", () => {
  const keywordCoverage = buildKeywordCoverage();
  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: [
      buildCompletedTailoring({
        tailoredResumeId: "stale-tailored-id",
      }),
    ],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary({ keywordCoverage })],
  });

  assert.equal(badge?.tailoredResumeId, "stale-tailored-id");
  assert.equal(badge?.keywordCoverage, keywordCoverage);
});

test("builds company resume download names from company or display name", () => {
  assert.equal(
    buildCompanyResumeDownloadName({
      companyName: "Notion",
      displayName: "Notion - Product Designer",
    }),
    "Notion.pdf",
  );
  assert.equal(
    buildCompanyResumeDownloadName({
      companyName: null,
      displayName: "Acme/AI - Senior Product Engineer",
    }),
    "Acme-AI.pdf",
  );
  assert.equal(
    buildCompanyResumeDownloadName({
      companyName: null,
      displayName: "Palantir Resume.pdf",
    }),
    "Palantir.pdf",
  );
});

test("does not show the generated-resume badge for failed completed artifacts", () => {
  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: [],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [
      buildTailoredResumeSummary({
        status: "error",
      }),
    ],
  });

  assert.equal(badge, null);
});
