import assert from "node:assert/strict";
import test from "node:test";
import { buildTailoringRunsRefreshKey } from "../extension/src/tailor-run-refresh.ts";

function buildRun(overrides: Partial<{
  capturedAt: string;
  pageUrl: string | null;
  status: "error" | "needs_input" | "running" | "success";
  tailoredResumeId: string | null;
}> = {}) {
  return {
    capturedAt: overrides.capturedAt ?? "2026-04-26T12:00:00.000Z",
    companyName: "OpenAI",
    endpoint: "http://localhost:3000/api/tailor-resume",
    generationStep: null,
    jobIdentifier: null,
    message: "Tailoring...",
    pageTitle: "Job posting",
    pageUrl: overrides.pageUrl ?? "https://jobs.example.com/roles/1",
    positionTitle: "Research Engineer",
    status: overrides.status ?? "running",
    tailoredResumeError: null,
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
