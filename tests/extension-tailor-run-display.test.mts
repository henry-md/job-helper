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

test("does not keep a completed run shell visible after switching tabs", () => {
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
    false,
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

test("does not synthesize a completed tailored resume id from the last run", () => {
  assert.equal(
    resolveReviewableTailoredResumeId({
      completedTailoringId: null,
      currentPageTailoredResumeId: null,
    }),
    null,
  );
});

test("prefers the synced completed tailoring over the stale last run id", () => {
  assert.equal(
    resolveReviewableTailoredResumeId({
      completedTailoringId: "resume_synced",
      currentPageTailoredResumeId: null,
    }),
    "resume_synced",
  );
});
