import assert from "node:assert/strict";
import test from "node:test";
import { filterVisibleTailoredResumes } from "../extension/src/tailored-resume-visibility.ts";

function buildTailoredResume(
  overrides: Partial<{
    applicationId: string | null;
    archivedAt: string | null;
    createdAt: string;
    displayName: string;
    id: string;
    jobUrl: string | null;
    updatedAt: string;
  }> = {},
) {
  return {
    applicationId: null,
    archivedAt: null,
    companyName: "Microsoft",
    createdAt: "2026-04-26T18:32:00.000Z",
    displayName: "Microsoft - Software Engineer",
    emphasizedTechnologies: [],
    id: "tailored-1",
    jobIdentifier: null,
    jobUrl: "https://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com",
    keywordCoverage: null,
    positionTitle: "Software Engineer",
    status: "ready",
    updatedAt: "2026-04-26T18:32:00.000Z",
    ...overrides,
  };
}

test("hides a saved resume while a matching active run shell already owns that url", () => {
  const visibleResumes = filterVisibleTailoredResumes({
    activeReferences: [
      {
        applicationId: null,
        existingTailoringId: null,
        url: "https://apply.careers.microsoft.com/careers/job/123",
      },
    ],
    resumes: [
      buildTailoredResume(),
      buildTailoredResume({
        displayName: "Other role",
        id: "tailored-2",
        jobUrl: "https://apply.careers.microsoft.com/careers/job/456?domain=microsoft.com",
      }),
    ],
  });

  assert.deepEqual(
    visibleResumes.map((resume) => resume.id),
    ["tailored-2"],
  );
});

test("hides a saved Workday resume while a matching alias active run is visible", () => {
  const visibleResumes = filterVisibleTailoredResumes({
    activeReferences: [
      {
        applicationId: null,
        existingTailoringId: null,
        url: "https://pae.wd1.myworkdayjobs.com/en-US/2/job/US-VA-Dahlgren/Entry-Level-Software-Engineer_R0160036?source=extension",
      },
    ],
    resumes: [
      buildTailoredResume({
        id: "tailored-old",
        jobUrl:
          "https://pae.wd1.myworkdayjobs.com/en-US/Amentum_Careers/job/Entry-Level-Software-Engineer_R0160036",
      }),
      buildTailoredResume({
        displayName: "Other role",
        id: "tailored-other",
        jobUrl: "https://pae.wd1.myworkdayjobs.com/en-US/Amentum_Careers/job/Entry-Level-Software-Engineer_R0160035",
      }),
    ],
  });

  assert.deepEqual(
    visibleResumes.map((resume) => resume.id),
    ["tailored-other"],
  );
});

test("hides saved fallback rows by application while replacement generation is active", () => {
  const visibleResumes = filterVisibleTailoredResumes({
    activeReferences: [
      {
        applicationId: "app-123",
        existingTailoringId: "run-123",
        suppressedTailoredResumeId: "tailored-old",
        url: "https://jobs.example.com/replacement-url",
      },
    ],
    resumes: [
      buildTailoredResume({
        applicationId: "app-123",
        id: "tailored-old",
        jobUrl: "https://jobs.example.com/original-url",
      }),
      buildTailoredResume({
        applicationId: "app-456",
        id: "tailored-other",
        jobUrl: "https://jobs.example.com/other-url",
      }),
    ],
  });

  assert.deepEqual(
    visibleResumes.map((resume) => resume.id),
    ["tailored-other"],
  );
});

test("dedupes saved resumes that normalize to the same comparable job url", () => {
  const visibleResumes = filterVisibleTailoredResumes({
    resumes: [
      buildTailoredResume({
        createdAt: "2026-04-26T18:00:00.000Z",
        displayName: "Older copy",
        id: "tailored-old",
        updatedAt: "2026-04-26T18:00:00.000Z",
      }),
      buildTailoredResume({
        createdAt: "2026-04-26T19:00:00.000Z",
        displayName: "Newest copy",
        id: "tailored-new",
        jobUrl:
          "https://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com&hl=en",
        updatedAt: "2026-04-26T19:00:00.000Z",
      }),
    ],
  });

  assert.deepEqual(
    visibleResumes.map((resume) => resume.id),
    ["tailored-new"],
  );
});

test("dedupes saved resumes linked to the same application", () => {
  const visibleResumes = filterVisibleTailoredResumes({
    resumes: [
      buildTailoredResume({
        applicationId: "app-123",
        createdAt: "2026-04-26T19:00:00.000Z",
        displayName: "Newest copy",
        id: "tailored-new",
        jobUrl: "https://jobs.example.com/new-url",
        updatedAt: "2026-04-26T19:00:00.000Z",
      }),
      buildTailoredResume({
        applicationId: "app-123",
        createdAt: "2026-04-26T18:00:00.000Z",
        displayName: "Older copy",
        id: "tailored-old",
        jobUrl: "https://jobs.example.com/old-url",
        updatedAt: "2026-04-26T18:00:00.000Z",
      }),
    ],
  });

  assert.deepEqual(
    visibleResumes.map((resume) => resume.id),
    ["tailored-new"],
  );
});
