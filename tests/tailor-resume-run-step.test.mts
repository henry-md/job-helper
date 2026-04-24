import assert from "node:assert/strict";
import test from "node:test";
import { buildTailorResumeRunStepUpdate } from "../lib/tailor-resume-run-step.ts";

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
