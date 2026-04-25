import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCompletedTailoringForPage,
  resolvePotentialTailorOverwrite,
} from "../extension/src/tailor-overwrite-guard.ts";

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

function buildActiveTailoring(
  overrides: Partial<{
    createdAt: string;
    id: string;
    jobDescription: string;
    jobIdentifier: string | null;
    jobUrl: string | null;
    lastStep: {
      attempt: number | null;
      detail: string | null;
      retrying: boolean;
      status: "failed" | "running" | "skipped" | "succeeded";
      stepCount: number;
      stepNumber: number;
      summary: string;
    } | null;
    updatedAt: string;
  }> = {},
) {
  return {
    createdAt: "2026-04-25T15:00:00.000Z",
    id: "run-123",
    jobDescription: "Role text",
    jobIdentifier: "Software Engineer",
    jobUrl: "https://jobs.example.com/roles/123",
    kind: "active_generation" as const,
    lastStep: null,
    updatedAt: "2026-04-25T15:05:00.000Z",
    ...overrides,
  };
}

function buildTailoredResumeSummary(
  overrides: Partial<{
    companyName: string | null;
    displayName: string;
    id: string;
    jobIdentifier: string | null;
    jobUrl: string | null;
    positionTitle: string | null;
    status: string | null;
    updatedAt: string;
  }> = {},
) {
  return {
    companyName: "Example Corp",
    displayName: "Example Corp - Software Engineer",
    id: "tailored-123",
    jobIdentifier: "Software Engineer",
    jobUrl: "https://jobs.example.com/roles/123?utm_campaign=saved",
    positionTitle: "Software Engineer",
    status: "ready",
    updatedAt: "2026-04-25T15:10:00.000Z",
    ...overrides,
  };
}

test("prefers the active tailoring when it matches the current page", () => {
  const result = resolvePotentialTailorOverwrite({
    activeTailorings: [buildActiveTailoring()],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary()],
  });

  assert.equal(result?.kind, "active_generation");
  assert.equal(result?.id, "run-123");
});

test("returns a completed overwrite prompt when a saved tailored resume matches", () => {
  const result = resolvePotentialTailorOverwrite({
    activeTailorings: [],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary()],
  });

  assert.deepEqual(result, {
    companyName: "Example Corp",
    displayName: "Example Corp - Software Engineer",
    error: null,
    id: "tailored-123",
    jobIdentifier: "Software Engineer",
    jobUrl: "https://jobs.example.com/roles/123?utm_campaign=saved",
    kind: "completed",
    positionTitle: "Software Engineer",
    status: "ready",
    tailoredResumeId: "tailored-123",
    updatedAt: "2026-04-25T15:10:00.000Z",
  });
});

test("returns the saved completed tailoring for the current page", () => {
  const result = resolveCompletedTailoringForPage({
    activeTailorings: [],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary()],
  });

  assert.equal(result?.kind, "completed");
  assert.equal(result?.tailoredResumeId, "tailored-123");
});

test("does not surface a completed page fallback while a matching run is active", () => {
  const result = resolveCompletedTailoringForPage({
    activeTailorings: [buildActiveTailoring()],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [buildTailoredResumeSummary()],
  });

  assert.equal(result, null);
});

test("ignores unrelated active runs and saved resumes", () => {
  const result = resolvePotentialTailorOverwrite({
    activeTailorings: [
      buildActiveTailoring({
        id: "run-other",
        jobUrl: "https://jobs.example.com/roles/999",
      }),
    ],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [
      buildTailoredResumeSummary({
        id: "tailored-other",
        jobUrl: "https://jobs.example.com/roles/456",
      }),
    ],
  });

  assert.equal(result, null);
});

test("matches the current page even when other jobs are running in parallel", () => {
  const result = resolvePotentialTailorOverwrite({
    activeTailorings: [
      buildActiveTailoring({
        id: "run-other",
        jobUrl: "https://jobs.example.com/roles/999",
      }),
      buildActiveTailoring(),
    ],
    pageIdentity: buildPageIdentity(),
    tailoredResumes: [],
  });

  assert.equal(result?.kind, "active_generation");
  assert.equal(result?.id, "run-123");
});
