import assert from "node:assert/strict";
import test from "node:test";
import {
  readTailorResumeGenerationStepSummary,
  type TailorResumeRunRecord,
} from "../extension/src/job-helper.ts";
import {
  findTailoringRunForKeywordBadgePage,
  isActiveTailoringRunForKeywords,
  readTailorRunKeywordTechnologies,
  readStoredTailoringRunRecord,
  resolveActiveTailorRunKeywordBadge,
} from "../extension/src/tailor-run-keywords.ts";

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
      canonicalUrl: "https://jobs.example.com/roles/123?utm_source=extension",
      jobUrl: null,
      pageUrl: "https://jobs.example.com/roles/123?utm_source=extension#overview",
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
      canonicalUrl: "https://jobs.example.com/roles/123?utm_source=extension",
      jobUrl: null,
      pageUrl: "https://jobs.example.com/roles/123?utm_source=extension",
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

test("uses the classified Step 2 keyword review snapshot during later steps", () => {
  const technologies = readTailorRunKeywordTechnologies(
    buildRun({
      generationStep: {
        attempt: 1,
        detail: "Planner identified block changes.",
        durationMs: 200,
        emphasizedTechnologies: [
          {
            evidence: "Planner targeted API development.",
            name: "API development",
            priority: "high",
          },
          {
            evidence: "Planner targeted AI systems.",
            name: "AI systems",
            priority: "low",
          },
        ],
        retrying: false,
        status: "succeeded",
        stepCount: 5,
        stepNumber: 3,
        summary: "Generating edit intent outline",
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
              evidence: "Posting asks for API development.",
              name: "API development",
              priority: "high",
            },
            {
              evidence: "Nice-to-have section mentions AI systems.",
              name: "AI systems",
              priority: "low",
            },
          ],
          observedAt: "2026-05-05T14:00:17.000Z",
          retrying: false,
          status: "succeeded",
          stepCount: 5,
          stepNumber: 1,
          summary: "Scrape keywords",
        },
        {
          attempt: null,
          detail: "All skills-section keywords are covered.",
          durationMs: 0,
          emphasizedTechnologies: [
            {
              classification: "skills_section",
              evidence: "Required section lists TypeScript.",
              name: "TypeScript",
              priority: "high",
            },
            {
              classification: "narrative",
              evidence: "Posting asks for API development.",
              name: "API development",
              priority: "high",
            },
            {
              classification: "narrative",
              evidence: "Nice-to-have section mentions AI systems.",
              name: "AI systems",
              priority: "low",
            },
          ],
          observedAt: "2026-05-05T14:01:00.000Z",
          retrying: false,
          status: "running",
          stepCount: 5,
          stepNumber: 2,
          summary: "Review classified keywords",
        },
      ],
    }),
  );

  assert.deepEqual(
    technologies.map((technology) => [
      technology.name,
      technology.priority,
      technology.classification,
    ]),
    [
      ["TypeScript", "high", "skills_section"],
      ["API development", "high", "narrative"],
      ["AI systems", "low", "narrative"],
    ],
  );
});

test("parses Step 2 blocking skills-section terms separately from all keywords", () => {
  const step = readTailorResumeGenerationStepSummary({
    attempt: 1,
    blockingTechnologies: [
      {
        classification: "skills_section",
        evidence: "Resume did not mention Kubernetes.",
        name: "Kubernetes",
        priority: "high",
      },
      {
        classification: "skills_section",
        evidence: "Resume did not mention Terraform.",
        name: "Terraform",
        priority: "low",
      },
    ],
    detail: "Still waiting on 2 skills-section blockers.",
    durationMs: 42,
    emphasizedTechnologies: [
      {
        classification: "skills_section",
        evidence: "Posting lists Kubernetes.",
        name: "Kubernetes",
        priority: "high",
      },
      {
        classification: "narrative",
        evidence: "Posting mentions load balancing.",
        name: "Load balancing",
        priority: "high",
      },
    ],
    retrying: false,
    status: "running",
    stepCount: 5,
    stepNumber: 2,
    summary: "Waiting for skills-section support",
  });

  assert.deepEqual(
    step?.blockingTechnologies?.map((technology) => technology.name),
    ["Kubernetes", "Terraform"],
  );
  assert.deepEqual(
    step?.emphasizedTechnologies?.map((technology) => technology.name),
    ["Kubernetes", "Load balancing"],
  );
});

test("ignores completed local runs when resolving active keyword badges", () => {
  const badge = resolveActiveTailorRunKeywordBadge({
    pageIdentity: {
      canonicalUrl: "https://jobs.example.com/roles/123?utm_source=extension",
      jobUrl: null,
      pageUrl: "https://jobs.example.com/roles/123?utm_source=extension",
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

test("findTailoringRunForKeywordBadgePage exposes completed matching runs so stale memory can be cleared", () => {
  const completedRun = buildRun({
    status: "success",
    tailoredResumeId: "tailored-123",
  });
  const matchingRun = findTailoringRunForKeywordBadgePage({
    pageIdentity: {
      canonicalUrl: "https://jobs.example.com/roles/123?utm_source=extension",
      jobUrl: null,
      pageUrl: "https://jobs.example.com/roles/123?utm_source=extension",
    },
    runs: [
      buildRun({
        pageUrl: "https://jobs.example.com/roles/999",
      }),
      completedRun,
    ],
  });

  assert.equal(matchingRun?.tailoredResumeId, "tailored-123");
  assert.equal(
    matchingRun ? isActiveTailoringRunForKeywords(matchingRun) : true,
    false,
  );
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
