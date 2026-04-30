import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailorResumeRunStepUpdate,
  buildTailorResumeTerminalFailureStepEvent,
} from "../lib/tailor-resume-run-step.ts";

test("failed step events keep the overall tailoring run active until the route decides the final status", () => {
  const update = buildTailorResumeRunStepUpdate({
    attempt: 3,
    detail:
      "No proposed compaction candidate reduced its block's measured rendered line count.",
    durationMs: 12_345,
    retrying: false,
    status: "failed",
    stepCount: 4,
    stepNumber: 4,
    summary: "Keeping the tailored resume within the original page count",
  });

  assert.equal(update.status, "RUNNING");
  assert.equal(
    update.error,
    "No proposed compaction candidate reduced its block's measured rendered line count.",
  );
  assert.equal(update.stepStatus, "failed");
  assert.equal(update.stepNumber, 4);
});

test("terminal backend failures reuse the latest running step as a failed step", () => {
  const stepEvent = buildTailorResumeTerminalFailureStepEvent({
    detail: "Step 1: The model request timed out.",
    fallbackStepNumber: 1,
    fallbackSummary: "Generating plaintext edit outline",
    previousStepEvent: {
      attempt: 2,
      detail: "Retrying the planning pass after validation failed.",
      durationMs: 1000,
      retrying: true,
      status: "running",
      stepCount: 4,
      stepNumber: 1,
      summary: "Generating plaintext edit outline",
    },
  });

  assert.deepEqual(stepEvent, {
    attempt: 2,
    detail: "Step 1: The model request timed out.",
    durationMs: 0,
    retrying: false,
    status: "failed",
    stepCount: 4,
    stepNumber: 1,
    summary: "Generating plaintext edit outline",
  });
});
