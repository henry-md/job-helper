import assert from "node:assert/strict";
import test from "node:test";
import { filterVisibleTailoredResumes } from "../extension/src/tailored-resume-visibility.ts";

function buildTailoredResume(
  overrides: Partial<{
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
    id: "tailored-1",
    jobIdentifier: null,
    jobUrl: "https://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com",
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

test("dedupes saved resumes that normalize to the same comparable job url", () => {
  const visibleResumes = filterVisibleTailoredResumes({
    resumes: [
      buildTailoredResume({
        createdAt: "2026-04-26T19:00:00.000Z",
        displayName: "Newest copy",
        id: "tailored-new",
        jobUrl:
          "https://apply.careers.microsoft.com/careers/job/123?domain=microsoft.com&hl=en",
        updatedAt: "2026-04-26T19:00:00.000Z",
      }),
      buildTailoredResume({
        createdAt: "2026-04-26T18:00:00.000Z",
        displayName: "Older copy",
        id: "tailored-old",
        updatedAt: "2026-04-26T18:00:00.000Z",
      }),
    ],
  });

  assert.deepEqual(
    visibleResumes.map((resume) => resume.id),
    ["tailored-new"],
  );
});
