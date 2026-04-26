import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDisplayedTailorRunIdentity,
  resolveReviewableTailoredResumeId,
  shouldRenderTailorRunShell,
} from "../extension/src/tailor-run-display.ts";

test("prefers stored active-run identity over the current tab metadata", () => {
  const result = resolveDisplayedTailorRunIdentity({
    activeTailoring: {
      companyName: "OpenAI",
      positionTitle: "Research Engineer",
    },
    completedTailoring: null,
    currentPageApplicationContext: {
      companyName: "GitHub",
      jobTitle: "henry-md/job-helper: Tailor resumes for jobs",
    },
    lastTailoringRun: null,
    shouldUseOptimisticTailorRunIdentity: true,
  });

  assert.deepEqual(result, {
    label: "OpenAI — Research Engineer",
    title: "OpenAI — Research Engineer",
  });
});

test("falls back to the current tab only before a run has stored identity", () => {
  const result = resolveDisplayedTailorRunIdentity({
    activeTailoring: null,
    completedTailoring: null,
    currentPageApplicationContext: {
      companyName: "GitHub",
      jobTitle: "henry-md/job-helper: Tailor resumes for jobs",
    },
    lastTailoringRun: null,
    shouldUseOptimisticTailorRunIdentity: true,
  });

  assert.deepEqual(result, {
    label: "GitHub — henry-md/job-helper: Tailor resumes for jobs",
    title: "GitHub — henry-md/job-helper: Tailor resumes for jobs",
  });
});

test("hides the tailor run shell when the current page has no tailoring state", () => {
  assert.equal(
    shouldRenderTailorRunShell({
      activeTailoringKind: null,
      captureState: "idle",
      hasCurrentPageCompletedTailoring: false,
      hasExistingTailoringPrompt: false,
      hasTailorInterview: false,
      isStoppingCurrentTailoring: false,
      isTailorPreparationPending: false,
      lastTailoringRunStatus: null,
    }),
    false,
  );
});

test("keeps a running tailoring visible even after switching tabs", () => {
  assert.equal(
    shouldRenderTailorRunShell({
      activeTailoringKind: null,
      captureState: "idle",
      hasCurrentPageCompletedTailoring: false,
      hasExistingTailoringPrompt: false,
      hasTailorInterview: false,
      isStoppingCurrentTailoring: false,
      isTailorPreparationPending: false,
      lastTailoringRunStatus: "running",
    }),
    true,
  );
});

test("keeps a completed run visible even after switching tabs", () => {
  assert.equal(
    shouldRenderTailorRunShell({
      activeTailoringKind: null,
      captureState: "idle",
      hasCurrentPageCompletedTailoring: false,
      hasExistingTailoringPrompt: false,
      hasTailorInterview: false,
      isStoppingCurrentTailoring: false,
      isTailorPreparationPending: false,
      lastTailoringRunStatus: "success",
    }),
    true,
  );
});

test("keeps an errored run visible even after switching tabs", () => {
  assert.equal(
    shouldRenderTailorRunShell({
      activeTailoringKind: null,
      captureState: "idle",
      hasCurrentPageCompletedTailoring: false,
      hasExistingTailoringPrompt: false,
      hasTailorInterview: false,
      isStoppingCurrentTailoring: false,
      isTailorPreparationPending: false,
      lastTailoringRunStatus: "error",
    }),
    true,
  );
});

test("reuses the last run tailored resume id before the saved list refreshes", () => {
  assert.equal(
    resolveReviewableTailoredResumeId({
      completedTailoringId: null,
      currentPageTailoredResumeId: null,
      lastTailoringRunTailoredResumeId: "resume_123",
      matchedLastTailoredResume: null,
    }),
    "resume_123",
  );
});

test("suppresses the last run tailored resume id once the saved list marks it archived", () => {
  assert.equal(
    resolveReviewableTailoredResumeId({
      completedTailoringId: null,
      currentPageTailoredResumeId: null,
      lastTailoringRunTailoredResumeId: "resume_123",
      matchedLastTailoredResume: {
        archivedAt: "2026-04-26T17:55:00.000Z",
        id: "resume_123",
      },
    }),
    null,
  );
});

test("prefers the synced completed tailoring over the stale last run id", () => {
  assert.equal(
    resolveReviewableTailoredResumeId({
      completedTailoringId: "resume_synced",
      currentPageTailoredResumeId: null,
      lastTailoringRunTailoredResumeId: "resume_123",
      matchedLastTailoredResume: null,
    }),
    "resume_synced",
  );
});
