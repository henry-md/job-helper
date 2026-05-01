import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTailorRunElapsedTime,
  formatTailorRunStepTimeDisplay,
  resolveDisplayedTailorRunIdentity,
  resolveReviewableTailoredResumeId,
  shouldRenderLegacyTailorRunShell,
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

test("formats loading elapsed time from zero seconds", () => {
  const startedAtTime = Date.parse("2026-04-29T19:52:18.000Z");

  assert.equal(
    formatTailorRunElapsedTime({
      nowTime: startedAtTime,
      startedAtTime,
    }),
    "0:00",
  );
});

test("formats loading elapsed time with single and double digit minutes", () => {
  const startedAtTime = Date.parse("2026-04-29T19:52:18.000Z");

  assert.equal(
    formatTailorRunElapsedTime({
      nowTime: startedAtTime + 9 * 60 * 1000 + 5 * 1000,
      startedAtTime,
    }),
    "9:05",
  );
  assert.equal(
    formatTailorRunElapsedTime({
      nowTime: startedAtTime + 10 * 60 * 1000,
      startedAtTime,
    }),
    "10:00",
  );
});

test("clamps missing or future loading elapsed time to zero", () => {
  const nowTime = Date.parse("2026-04-29T19:52:18.000Z");

  assert.equal(
    formatTailorRunElapsedTime({
      nowTime,
      startedAtTime: 0,
    }),
    "0:00",
  );
  assert.equal(
    formatTailorRunElapsedTime({
      nowTime,
      startedAtTime: nowTime + 1000,
    }),
    "0:00",
  );
});

test("formats specific tailor run timing as one value per completed and running step", () => {
  const runStartedAtTime = Date.parse("2026-04-29T19:52:18.000Z");
  const step4ObservedAtTime = runStartedAtTime + 44_000 + 72_000 + 132_000;

  assert.equal(
    formatTailorRunStepTimeDisplay({
      activeStepNumber: 4,
      mode: "specific",
      nowTime: step4ObservedAtTime + 17_000,
      runStartedAtTime,
      timings: [
        {
          durationMs: 44_000,
          observedAtTime: runStartedAtTime + 44_000,
          retrying: false,
          status: "succeeded",
          stepNumber: 1,
        },
        {
          durationMs: 72_000,
          observedAtTime: runStartedAtTime + 44_000 + 72_000,
          retrying: false,
          status: "succeeded",
          stepNumber: 2,
        },
        {
          durationMs: 132_000,
          observedAtTime: step4ObservedAtTime,
          retrying: false,
          status: "succeeded",
          stepNumber: 3,
        },
        {
          durationMs: 0,
          observedAtTime: step4ObservedAtTime,
          retrying: false,
          status: "running",
          stepNumber: 4,
        },
      ],
    }),
    "0:44/1:12/2:12/0:17",
  );
});

test("formats aggregate tailor run timing as the total elapsed value", () => {
  const runStartedAtTime = Date.parse("2026-04-29T19:52:18.000Z");

  assert.equal(
    formatTailorRunStepTimeDisplay({
      activeStepNumber: 2,
      mode: "aggregate",
      nowTime: runStartedAtTime + 116_000,
      runStartedAtTime,
      timings: [
        {
          durationMs: 44_000,
          observedAtTime: runStartedAtTime + 44_000,
          retrying: false,
          status: "succeeded",
          stepNumber: 1,
        },
        {
          durationMs: 0,
          observedAtTime: runStartedAtTime + 44_000,
          retrying: false,
          status: "running",
          stepNumber: 2,
        },
      ],
    }),
    "1:56",
  );
});

test("falls back to run elapsed time for a current step without timing history", () => {
  const runStartedAtTime = Date.parse("2026-04-29T19:52:18.000Z");

  assert.equal(
    formatTailorRunStepTimeDisplay({
      activeStepNumber: 1,
      mode: "specific",
      nowTime: runStartedAtTime + 21_000,
      runStartedAtTime,
      timings: [],
    }),
    "0:21",
  );
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

test("keeps the legacy shell mounted for a current-page overwrite prompt", () => {
  assert.equal(
    shouldRenderLegacyTailorRunShell({
      hasCurrentPageCompletedTailoring: true,
      hasCurrentPageExistingTailoringPrompt: true,
      hasCurrentPageRunCard: false,
      shouldShowTailorRunShell: true,
    }),
    true,
  );
});

test("keeps completed current-page resumes on the row surface without a prompt", () => {
  assert.equal(
    shouldRenderLegacyTailorRunShell({
      hasCurrentPageCompletedTailoring: true,
      hasCurrentPageExistingTailoringPrompt: false,
      hasCurrentPageRunCard: false,
      shouldShowTailorRunShell: true,
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
