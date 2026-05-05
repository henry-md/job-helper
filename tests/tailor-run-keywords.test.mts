import assert from "node:assert/strict";
import test from "node:test";
import {
  readTailorRunKeywordTechnologies,
  readStoredTailoringRunRecord,
  resolveActiveTailorRunKeywordBadge,
} from "../extension/src/tailor-run-keywords.ts";
import type { TailorResumeRunRecord } from "../extension/src/job-helper.ts";

function buildRun(
  overrides: Partial<TailorResumeRunRecord> = {},
): TailorResumeRunRecord {
  return {
    applicationId: "app-123",
    capturedAt: "2026-05-05T14:00:00.000Z",
    companyName: "Example Corp",
    endpoint: "/api/tailor-resume",
    generationStep: null,
    generationStepTimings: [],
    jobIdentifier: null,
    message: "Tailoring your resume for this job...",
    pageTitle: "Example role",
    pageUrl: "https://jobs.example.com/roles/123?utm_source=extension",
    positionTitle: "Software Engineer",
    status: "running",
    suppressedTailoredResumeId: "tailored-old",
    tailoredResumeError: null,
    tailoredResumeId: null,
    ...overrides,
  };
}

test("resolves streamed keywords from the newest active local tailoring run", () => {
  const badge = resolveActiveTailorRunKeywordBadge({
    pageIdentity: {
      canonicalUrl: "https://jobs.example.com/roles/123",
      jobUrl: null,
      pageUrl: "https://jobs.example.com/roles/123#overview",
    },
    runs: [
      buildRun({
        capturedAt: "2026-05-05T13:00:00.000Z",
        generationStepTimings: [
          {
            attempt: null,
            detail: "Prepared older keywords.",
            durationMs: 10,
            emphasizedTechnologies: [
              {
                evidence: "Old posting listed TypeScript.",
                name: "TypeScript",
                priority: "high",
              },
            ],
            observedAt: "2026-05-05T13:00:05.000Z",
            retrying: false,
            status: "succeeded",
            stepCount: 5,
            stepNumber: 1,
            summary: "Scrape keywords",
          },
        ],
      }),
      buildRun({
        capturedAt: "2026-05-05T14:00:00.000Z",
        generationStep: {
          attempt: null,
          detail: "Prepared fresh keywords.",
          durationMs: 10,
          emphasizedTechnologies: [
            {
              evidence: "New posting lists Go.",
              name: "Go",
              priority: "high",
            },
          ],
          retrying: false,
          status: "succeeded",
          stepCount: 5,
          stepNumber: 1,
          summary: "Scrape keywords",
        },
      }),
    ],
  });

  assert.equal(badge?.run.capturedAt, "2026-05-05T14:00:00.000Z");
  assert.deepEqual(
    badge?.technologies.map((technology) => technology.name),
    ["Go"],
  );
});

test("keeps a matching active run even before keywords arrive", () => {
  const badge = resolveActiveTailorRunKeywordBadge({
    pageIdentity: {
      canonicalUrl: "https://jobs.example.com/roles/123",
      jobUrl: null,
      pageUrl: "https://jobs.example.com/roles/123",
    },
    runs: [buildRun()],
  });

  assert.equal(badge?.run.status, "running");
  assert.deepEqual(badge?.technologies, []);
});

test("keeps Step 1 scraped keywords when Step 2 carries a question subset", () => {
  const technologies = readTailorRunKeywordTechnologies(
    buildRun({
      generationStep: {
        attempt: null,
        detail: "Step 2 is asking about the uncovered subset.",
        durationMs: 18,
        emphasizedTechnologies: [
          {
            evidence: "The resume did not mention Cilium.",
            name: "Cilium",
            priority: "high",
          },
        ],
        retrying: false,
        status: "running",
        stepCount: 5,
        stepNumber: 2,
        summary: "Ready to review scraped technologies",
      },
      generationStepTimings: [
        {
          attempt: 1,
          detail: "Prepared all scraped keywords.",
          durationMs: 17,
          emphasizedTechnologies: [
            {
              evidence: "Required section lists TypeScript.",
              name: "TypeScript",
              priority: "high",
            },
            {
              evidence: "Required section lists Kubernetes.",
              name: "Kubernetes",
              priority: "high",
            },
          ],
          observedAt: "2026-05-05T14:00:17.000Z",
          retrying: false,
          status: "succeeded",
          stepCount: 5,
          stepNumber: 1,
          summary: "Scrape keywords",
        },
      ],
    }),
  );

  assert.deepEqual(
    technologies.map((technology) => technology.name),
    ["TypeScript", "Kubernetes"],
  );
});

test("ignores completed local runs when resolving active keyword badges", () => {
  const badge = resolveActiveTailorRunKeywordBadge({
    pageIdentity: {
      canonicalUrl: "https://jobs.example.com/roles/123",
      jobUrl: null,
      pageUrl: "https://jobs.example.com/roles/123",
    },
    runs: [
      buildRun({
        generationStep: {
          attempt: null,
          detail: "Prepared saved keywords.",
          durationMs: 10,
          emphasizedTechnologies: [
            {
              evidence: "Saved posting listed React.",
              name: "React",
              priority: "high",
            },
          ],
          retrying: false,
          status: "succeeded",
          stepCount: 5,
          stepNumber: 1,
          summary: "Scrape keywords",
        },
        status: "success",
        tailoredResumeId: "tailored-old",
      }),
    ],
  });

  assert.equal(badge, null);
});

test("parses stored run records with streamed keyword timings", () => {
  const record = readStoredTailoringRunRecord({
    capturedAt: "2026-05-05T14:00:00.000Z",
    generationStepTimings: [
      {
        attempt: null,
        detail: "Prepared fresh keywords.",
        durationMs: 10,
        emphasizedTechnologies: [
          {
            evidence: "Posting lists Cassandra.",
            name: "Cassandra",
            priority: "low",
          },
        ],
        observedAt: "2026-05-05T14:00:06.000Z",
        retrying: false,
        status: "succeeded",
        stepCount: 5,
        stepNumber: 1,
        summary: "Scrape keywords",
      },
    ],
    message: "Tailoring your resume for this job...",
    status: "running",
  });

  assert.equal(
    record?.generationStepTimings?.[0]?.emphasizedTechnologies?.[0]?.name,
    "Cassandra",
  );
});
