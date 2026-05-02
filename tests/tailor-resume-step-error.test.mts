import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailorResumeAttemptFailureMessage,
  formatTailorResumeStepError,
} from "../lib/tailor-resume-step-error.ts";

test("formatTailorResumeStepError prefixes step numbers", () => {
  assert.equal(
    formatTailorResumeStepError(
      4,
      "Replacement for segment experience.entry-1 failed to compile.",
    ),
    "Step 4: Replacement for segment experience.entry-1 failed to compile.",
  );
});

test("formatTailorResumeStepError does not double-prefix step numbers", () => {
  assert.equal(
    formatTailorResumeStepError(
      4,
      "Step 2: The previous step already added context.",
    ),
    "Step 2: The previous step already added context.",
  );
});

test("buildTailorResumeAttemptFailureMessage includes the step label", () => {
  assert.equal(
    buildTailorResumeAttemptFailureMessage({
      attempts: 2,
      stepNumber: 3,
      validationError: "The planning response schema was invalid.",
    }),
    "Unable to generate a valid tailored resume after 2 attempts: Step 3: The planning response schema was invalid.",
  );
});
