import assert from "node:assert/strict";
import test from "node:test";

function buildPersonalInfo() {
  return {
    activeTailoring: null,
    activeTailorings: [],
    applicationCount: 0,
    applications: [],
    companyCount: 0,
    generationSettings: {
      allowTailorResumeFollowUpQuestions: true,
      includeLowPriorityTermsInKeywordCoverage: false,
      preventPageCountIncrease: true,
    },
    originalResume: {
      error: null,
      filename: null,
      latexStatus: null,
      pdfUpdatedAt: null,
      resumeUpdatedAt: null,
    },
    syncState: {
      applicationsVersion: 1,
      tailoringVersion: 2,
    },
    tailoredResumes: [
      {
        applicationId: null,
        archivedAt: null,
        companyName: "Microsoft",
        createdAt: "2026-04-26T21:32:00.000Z",
        displayName: "Microsoft - Software Engineer II",
        emphasizedTechnologies: [],
        id: "tailored-1",
        jobIdentifier: null,
        jobUrl: "https://jobs.example.com/roles/1",
        keywordCoverage: null,
        positionTitle: "Software Engineer II",
        status: "ready",
        updatedAt: "2026-04-26T21:32:00.000Z",
      },
    ],
    tailoringInterview: null,
    tailoringInterviews: [],
    userMarkdown: {
      markdown: "# USER.md\n\n",
      updatedAt: null,
    },
  } as const;
}

test("personal info cache round-trips the shared summary payload", async () => {
  (globalThis as Record<string, unknown>).__DEBUG_UI__ = false;
  const {
    buildPersonalInfoCacheEntry,
    readPersonalInfoCacheEntry,
  } = await import("../extension/src/personal-info-cache.ts");
  const entry = buildPersonalInfoCacheEntry({
    cachedAt: "2026-04-26T21:40:00.000Z",
    personalInfo: buildPersonalInfo(),
    userId: "user-123",
  });
  const parsed = readPersonalInfoCacheEntry(entry);

  assert.deepEqual(parsed, entry);
});

test("personal info cache rejects entries without a user id", async () => {
  (globalThis as Record<string, unknown>).__DEBUG_UI__ = false;
  const { readPersonalInfoCacheEntry } = await import(
    "../extension/src/personal-info-cache.ts"
  );
  assert.equal(
    readPersonalInfoCacheEntry({
      cachedAt: "2026-04-26T21:40:00.000Z",
      personalInfo: buildPersonalInfo(),
    }),
    null,
  );
});

test("invalidates only the stale cached personal-info slices when sync versions change", async () => {
  (globalThis as Record<string, unknown>).__DEBUG_UI__ = false;
  const { invalidateChangedPersonalInfoSlices } = await import(
    "../extension/src/personal-info-cache.ts"
  );
  const personalInfo = buildPersonalInfo();
  const invalidated = invalidateChangedPersonalInfoSlices({
    nextSyncState: {
      applicationsVersion: 2,
      tailoringVersion: 3,
    },
    personalInfo,
  });

  assert.deepEqual(invalidated.applications, []);
  assert.equal(invalidated.applicationCount, 0);
  assert.equal(invalidated.companyCount, 0);
  assert.deepEqual(invalidated.activeTailorings, []);
  assert.equal(invalidated.activeTailoring, null);
  assert.deepEqual(invalidated.tailoredResumes, []);
  assert.equal(invalidated.tailoringInterview, null);
  assert.deepEqual(invalidated.tailoringInterviews, []);
  assert.deepEqual(invalidated.originalResume, personalInfo.originalResume);
  assert.deepEqual(invalidated.userMarkdown, personalInfo.userMarkdown);
  assert.deepEqual(invalidated.syncState, personalInfo.syncState);
});
