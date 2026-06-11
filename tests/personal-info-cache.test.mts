import assert from "node:assert/strict";
import test from "node:test";

function buildPersonalInfo() {
  return {
    activeTailoring: null,
    activeTailorings: [],
    generationSettings: {
      allowTailorResumeFollowUpQuestions: true,
      customResumeDownloadName: "Resume",
      includeLowPriorityTermsInKeywordCoverage: false,
      ludicrousMode: true,
      masterChatModel: "gpt-5.4",
      preventPageCountIncrease: true,
      step1Model: "gpt-5.4-mini",
      step3Model: "anthropic:claude-sonnet-4-6",
      step4Model: "gpt-5.5",
      step4bModel: "gpt-5.4",
      useCustomResumeDownloadName: false,
      version: 7,
    },
    originalResume: {
      error: null,
      filename: null,
      latexStatus: null,
      pdfUpdatedAt: null,
      resumeUpdatedAt: null,
    },
    promptSettings: {
      tailorResumeStep2ExperienceChat: null,
    },
    skillData: {
      keywordClassifications: [],
      resumeExperiences: [],
      skills: [],
      spareBullets: [],
      updatedAt: "",
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
        generationStepTimings: [],
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
    userMemory: {
      nonTechnologyNames: [],
      updatedAt: null,
      userMarkdown: {
        markdown: "# USER.md\n\n",
        nonTechnologies: [],
        updatedAt: null,
      },
    },
    userMarkdown: {
      markdown: "# USER.md\n\n",
      nonTechnologies: [],
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

test("invalidates transient personal-info slices without clearing saved resumes", async () => {
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

  assert.deepEqual(invalidated.activeTailorings, []);
  assert.equal(invalidated.activeTailoring, null);
  assert.deepEqual(invalidated.tailoredResumes, personalInfo.tailoredResumes);
  assert.deepEqual(invalidated.generationSettings, personalInfo.generationSettings);
  assert.equal(invalidated.tailoringInterview, null);
  assert.deepEqual(invalidated.tailoringInterviews, []);
  assert.deepEqual(invalidated.originalResume, personalInfo.originalResume);
  assert.deepEqual(invalidated.userMarkdown, personalInfo.userMarkdown);
  assert.deepEqual(invalidated.syncState, {
    applicationsVersion: 2,
    tailoringVersion: 3,
  });
});
