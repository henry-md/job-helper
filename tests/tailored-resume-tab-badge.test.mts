import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyResumeDownloadName } from "../lib/tailored-resume-download-filename.ts";
import { resolveTailoredResumeTabBadge } from "../extension/src/tailored-resume-tab-badge.ts";
import type {
  TailorResumeExistingTailoringState,
  TailoredResumeSummary,
} from "../extension/src/job-helper.ts";

function buildPageIdentity(
  overrides: Partial<{
    canonicalUrl: string | null;
    jobUrl: string | null;
    pageUrl: string | null;
  }> = {},
) {
  return {
    canonicalUrl: "https://jobs.example.com/roles/123?utm_source=mail",
    jobUrl: "https://jobs.example.com/roles/123?ref=extension",
    pageUrl: "https://jobs.example.com/roles/123/#overview",
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
    jobUrl: "https://jobs.example.com/roles/123?utm_campaign=saved",
    keywordCoverage: null,
    positionTitle: "Software Engineer",
    status: "ready",
    updatedAt: "2026-04-25T15:10:00.000Z",
    ...overrides,
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
    id: "run-123",
    jobDescription: "Role text",
    jobIdentifier: "Software Engineer",
    jobUrl: "https://jobs.example.com/roles/123",
    kind: "active_generation",
    lastStep: null,
    positionTitle: "Software Engineer",
    updatedAt: "2026-04-25T15:05:00.000Z",
    ...overrides,
  };
}

test("returns a tab badge for a completed tailored resume matching the page URL", () => {
  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: [],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary()],
  });

  assert.deepEqual(badge, {
    badgeKey: "tailored-resume:tailored-123",
    companyName: "Example Corp",
    displayName: "Example Corp - Software Engineer",
    downloadName: "Example Corp Resume.pdf",
    emphasizedTechnologies: [
      {
        evidence: "Required section lists TypeScript.",
        name: "TypeScript",
        priority: "high",
      },
    ],
    jobUrl: "https://jobs.example.com/roles/123?utm_campaign=saved",
    keywordCoverage: null,
    tailoredResumeId: "tailored-123",
  });
});

test("does not show the generated-resume badge while a matching run is active", () => {
  const badge = resolveTailoredResumeTabBadge({
    activeTailorings: [buildActiveTailoring()],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary()],
  });

  assert.equal(badge, null);
});

test("builds company resume download names from company or display name", () => {
  assert.equal(
    buildCompanyResumeDownloadName({
      companyName: "Notion",
      displayName: "Notion - Product Designer",
    }),
    "Notion Resume.pdf",
  );
  assert.equal(
    buildCompanyResumeDownloadName({
      companyName: null,
      displayName: "Acme/AI - Senior Product Engineer",
    }),
    "Acme-AI Resume.pdf",
  );
  assert.equal(
    buildCompanyResumeDownloadName({
      companyName: null,
      displayName: "Palantir Resume.pdf",
    }),
    "Palantir Resume.pdf",
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
