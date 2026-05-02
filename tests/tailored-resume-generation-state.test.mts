import assert from "node:assert/strict";
import test from "node:test";
import {
  getTailoredResumeGenerationFailureLabel,
  hasTailoredResumeGenerationFailure,
} from "../lib/tailored-resume-generation-state.ts";

test("step-4 reviewable failures are classified as failed generations", () => {
  assert.equal(
    hasTailoredResumeGenerationFailure({
      error: "Step 5: The compacted resume still rendered to 2 pages instead of 1 page.",
      status: "ready",
    }),
    true,
  );
  assert.equal(
    getTailoredResumeGenerationFailureLabel({
      error: "Step 5: The compacted resume still rendered to 2 pages instead of 1 page.",
      status: "ready",
    }),
    "Failed generation",
  );
});

test("compile-only failures are still surfaced in the saved resume history", () => {
  assert.equal(
    hasTailoredResumeGenerationFailure({
      error: null,
      status: "failed",
    }),
    true,
  );
  assert.equal(
    getTailoredResumeGenerationFailureLabel({
      error: null,
      status: "failed",
    }),
    "Preview failed",
  );
});

test("successful tailored resumes are not marked as failures", () => {
  assert.equal(
    hasTailoredResumeGenerationFailure({
      error: null,
      status: "ready",
    }),
    false,
  );
  assert.equal(
    getTailoredResumeGenerationFailureLabel({
      error: null,
      status: "ready",
    }),
    null,
  );
});
