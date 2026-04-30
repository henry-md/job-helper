import assert from "node:assert/strict";
import test from "node:test";
import { buildTailoringRunsRefreshKey } from "../extension/src/tailor-run-refresh.ts";

function buildRun(overrides: Partial<{
  applicationId: string | null;
  capturedAt: string;
  generationStep: {
    attempt: number | null;
    detail: string | null;
    retrying: boolean;
    status: "failed" | "running" | "skipped" | "succeeded";
    stepCount: number;
    stepNumber: number;
    summary: string;
  } | null;
  message: string;
  pageUrl: string | null;
  status: "error" | "needs_input" | "running" | "success";
  suppressedTailoredResumeId: string | null;
  tailoredResumeError: string | null;
  tailoredResumeId: string | null;
}> = {}) {
  return {
    applicationId: overrides.applicationId ?? null,
    capturedAt: overrides.capturedAt ?? "2026-04-26T12:00:00.000Z",
    companyName: "OpenAI",
    endpoint: "http://localhost:1285/api/tailor-resume",
    generationStep: overrides.generationStep ?? null,
    jobIdentifier: null,
    message: overrides.message ?? "Tailoring...",
    pageTitle: "Job posting",
    pageUrl: overrides.pageUrl ?? "https://jobs.example.com/roles/1",
    positionTitle: "Research Engineer",
    status: overrides.status ?? "running",
    suppressedTailoredResumeId: overrides.suppressedTailoredResumeId ?? null,
    tailoredResumeError: overrides.tailoredResumeError ?? null,
    tailoredResumeId: overrides.tailoredResumeId ?? null,
  };
}

test("buildTailoringRunsRefreshKey is stable across object insertion order", () => {
  const left = buildTailoringRunsRefreshKey({
    "https://jobs.example.com/roles/2": buildRun({
      capturedAt: "2026-04-26T12:05:00.000Z",
      pageUrl: "https://jobs.example.com/roles/2",
    }),
    "https://jobs.example.com/roles/1": buildRun(),
  });
  const right = buildTailoringRunsRefreshKey({
    "https://jobs.example.com/roles/1": buildRun(),
    "https://jobs.example.com/roles/2": buildRun({
      capturedAt: "2026-04-26T12:05:00.000Z",
      pageUrl: "https://jobs.example.com/roles/2",
    }),
  });

  assert.equal(left, right);
});

test("buildTailoringRunsRefreshKey changes when another tab's run status changes", () => {
  const before = buildTailoringRunsRefreshKey({
    "https://jobs.example.com/roles/1": buildRun(),
    "https://jobs.example.com/roles/2": buildRun({
      capturedAt: "2026-04-26T12:05:00.000Z",
      pageUrl: "https://jobs.example.com/roles/2",
      status: "running",
    }),
  });
  const after = buildTailoringRunsRefreshKey({
    "https://jobs.example.com/roles/1": buildRun(),
    "https://jobs.example.com/roles/2": buildRun({
      capturedAt: "2026-04-26T12:05:00.000Z",
      pageUrl: "https://jobs.example.com/roles/2",
      status: "success",
      tailoredResumeId: "tailored-2",
    }),
  });

  assert.notEqual(before, after);
});

test("buildTailoringRunsRefreshKey changes when a running step starts retrying", () => {
  const before = buildTailoringRunsRefreshKey({
    "https://jobs.example.com/roles/1": buildRun({
      generationStep: {
        attempt: 1,
        detail: "Starting the planning pass.",
        retrying: false,
        status: "running",
        stepCount: 4,
        stepNumber: 1,
        summary: "Generating plaintext edit outline",
      },
    }),
  });
  const after = buildTailoringRunsRefreshKey({
    "https://jobs.example.com/roles/1": buildRun({
      generationStep: {
        attempt: 2,
        detail: "Retrying after the previous attempt failed validation.",
        retrying: true,
        status: "running",
        stepCount: 4,
        stepNumber: 1,
        summary: "Generating plaintext edit outline",
      },
    }),
  });

  assert.notEqual(before, after);
});
