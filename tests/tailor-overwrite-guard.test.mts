import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesTailorOverwritePageIdentity,
  resolveCompletedTailoringForPage,
  resolvePotentialTailorOverwrite,
  resolvePotentialTailorOverwriteFromPersonalInfo,
} from "../extension/src/tailor-overwrite-guard.ts";
import { normalizeComparableUrl } from "../extension/src/comparable-job-url.ts";

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

function buildActiveTailoring(
  overrides: Partial<{
    applicationId: string | null;
    createdAt: string;
    id: string;
    jobDescription: string;
    jobIdentifier: string | null;
    jobUrl: string | null;
    lastStep: {
      attempt: number | null;
      detail: string | null;
      durationMs: number;
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
    applicationId: "app-123",
    createdAt: "2026-04-25T15:00:00.000Z",
    id: "run-123",
    jobDescription: "Role text",
    jobIdentifier: "Software Engineer",
    jobUrl: matchingJobUrl,
    kind: "active_generation" as const,
    lastStep: null,
    updatedAt: "2026-04-25T15:05:00.000Z",
    ...overrides,
  };
}

function buildTailoredResumeSummary(
  overrides: Partial<{
    applicationId: string | null;
    archivedAt: string | null;
    companyName: string | null;
    createdAt: string;
    displayName: string;
    emphasizedTechnologies: Array<{
      evidence: string;
      name: string;
      priority: "high" | "low";
    }>;
    id: string;
    jobIdentifier: string | null;
    jobUrl: string | null;
    keywordCoverage: null;
    positionTitle: string | null;
    status: string | null;
    updatedAt: string;
  }> = {},
) {
  return {
    applicationId: "app-123",
    archivedAt: null,
    companyName: "Example Corp",
    createdAt: "2026-04-25T15:10:00.000Z",
    displayName: "Example Corp - Software Engineer",
    emphasizedTechnologies: [],
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
    applicationId: "app-123",
    companyName: "Example Corp",
    createdAt: "2026-04-25T15:10:00.000Z",
    displayName: "Example Corp - Software Engineer",
    emphasizedTechnologies: [],
    error: null,
    id: "tailored-123",
    jobIdentifier: "Software Engineer",
    jobUrl: matchingJobUrl,
    kind: "completed",
    positionTitle: "Software Engineer",
    status: "ready",
    tailoredResumeId: "tailored-123",
    updatedAt: "2026-04-25T15:10:00.000Z",
  });
});

test("resolves a cached completed overwrite match from personal info", () => {
  const result = resolvePotentialTailorOverwriteFromPersonalInfo({
    pageIdentity: buildPageIdentity(),
    personalInfo: {
      activeTailorings: [],
      tailoredResumes: [buildTailoredResumeSummary()],
    },
  });

  assert.equal(result?.kind, "completed");
  assert.equal(result?.tailoredResumeId, "tailored-123");
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

test("normalizeComparableUrl preserves the full query string", () => {
  assert.equal(
    normalizeComparableUrl(
      "https://apply.careers.microsoft.com/careers?domain=microsoft.com&start=0&location=United+States&pid=1970393556744821&sort_by=match&filter_include_remote=1",
    ),
    "https://apply.careers.microsoft.com/careers?domain=microsoft.com&start=0&location=United+States&pid=1970393556744821&sort_by=match&filter_include_remote=1",
  );
});

test("normalizeComparableUrl keeps Workday canonical URLs separate from query-bearing browser tabs", () => {
  assert.notEqual(
    normalizeComparableUrl(
      "https://pae.wd1.myworkdayjobs.com/en-US/Amentum_Careers/job/Entry-Level-Software-Engineer_R0160036",
    ),
    normalizeComparableUrl(
      "https://pae.wd1.myworkdayjobs.com/en-US/amentum_careers/job/US-VA-Dahlgren/Entry-Level-Software-Engineer_R0160036?utm_source=Simplify&ref=Simplify",
    ),
  );
});

test("normalizeComparableUrl keeps Workday career-site aliases separate", () => {
  assert.notEqual(
    normalizeComparableUrl(
      "https://pae.wd1.myworkdayjobs.com/en-US/Amentum_Careers/job/Entry-Level-Software-Engineer_R0160036",
    ),
    normalizeComparableUrl(
      "https://pae.wd1.myworkdayjobs.com/en-US/2/job/US-VA-Dahlgren/Entry-Level-Software-Engineer_R0160036?source=extension",
    ),
  );
});

test("normalizeComparableUrl keeps neighboring Workday requisitions separate", () => {
  assert.notEqual(
    normalizeComparableUrl(
      "https://pae.wd1.myworkdayjobs.com/en-US/amentum_careers/job/US-VA-Dahlgren/Entry-Level-Software-Engineer_R0160036?utm_source=Simplify&ref=Simplify",
    ),
    normalizeComparableUrl(
      "https://pae.wd1.myworkdayjobs.com/en-US/amentum_careers/job/US-VA-Dahlgren/Entry-Level-Software-Engineer_R0160035?utm_source=Simplify&ref=Simplify",
    ),
  );
});

test("does not treat different pid-based career pages as the same job", () => {
  assert.equal(
    matchesTailorOverwritePageIdentity({
      jobUrl:
        "https://apply.careers.microsoft.com/careers?domain=microsoft.com&start=0&location=United+States&pid=1970393556744821&sort_by=match&filter_include_remote=1",
      pageIdentity: {
        canonicalUrl:
          "https://apply.careers.microsoft.com/careers?domain=microsoft.com&query=software+engineer&start=0&location=United+States&pid=1970393556637410&sort_by=match&filter_include_remote=1&filter_seniority=Entry",
        jobUrl:
          "https://apply.careers.microsoft.com/careers?domain=microsoft.com&query=software+engineer&start=0&location=United+States&pid=1970393556637410&sort_by=match&filter_include_remote=1&filter_seniority=Entry",
        pageUrl:
          "https://apply.careers.microsoft.com/careers?domain=microsoft.com&query=software+engineer&start=0&location=United+States&pid=1970393556637410&sort_by=match&filter_include_remote=1&filter_seniority=Entry",
      },
    }),
    false,
  );
});

test("does not match pid-based career pages when any query params differ", () => {
  assert.equal(
    matchesTailorOverwritePageIdentity({
      jobUrl:
        "https://apply.careers.microsoft.com/careers?domain=microsoft.com&query=software+engineer&start=0&location=United+States&pid=1970393556637410&sort_by=match&filter_include_remote=1&filter_seniority=Entry",
      pageIdentity: {
        canonicalUrl:
          "https://apply.careers.microsoft.com/careers?pid=1970393556637410&utm_source=extension",
        jobUrl:
          "https://apply.careers.microsoft.com/careers?sort_by=recent&pid=1970393556637410",
        pageUrl:
          "https://apply.careers.microsoft.com/careers?domain=microsoft.com&pid=1970393556637410#job",
      },
    }),
    false,
  );
});

test("does not match a saved tailored resume when the current page is a nested apply URL", () => {
  assert.equal(
    matchesTailorOverwritePageIdentity({
      jobUrl: "https://jobs.example.com/roles/123",
      pageIdentity: {
        canonicalUrl: "https://jobs.example.com/roles/123/apply?utm_source=extension",
        jobUrl: null,
        pageUrl: "https://jobs.example.com/roles/123/apply",
      },
    }),
    false,
  );
});
