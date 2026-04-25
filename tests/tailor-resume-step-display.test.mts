import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailorResumeLiveStatusMessage,
  formatTailorResumeProgressStepLabel,
  formatTailorResumeProgressStatusLabel,
  readTailorResumeProgressAttemptBadgeLabel,
  readTailorResumeDisplayAttempt,
} from "../lib/tailor-resume-step-display.ts";

test("failed retry states display the upcoming attempt number", () => {
  assert.equal(
    readTailorResumeDisplayAttempt({
      attempt: 1,
      retrying: true,
      status: "failed",
    }),
    2,
  );
});

test("retrying status labels include the attempt number", () => {
  assert.equal(
    formatTailorResumeProgressStatusLabel({
      attempt: 2,
      status: "retrying",
    }),
    "Retrying (attempt 2)",
  );
});

test("active compact step labels append an ellipsis", () => {
  assert.equal(
    formatTailorResumeProgressStepLabel({
      label: "Keep the original page count",
      status: "current",
    }),
    "Keep the original page count...",
  );
});

test("compact retry badges appear only after the first attempt", () => {
  assert.equal(
    readTailorResumeProgressAttemptBadgeLabel({
      attempt: 2,
      status: "retrying",
    }),
    "Attempt 2",
  );

  assert.equal(
    readTailorResumeProgressAttemptBadgeLabel({
      attempt: 1,
      status: "current",
    }),
    null,
  );
});

test("live status messages use retry wording when a retry is in flight", () => {
  assert.equal(
    buildTailorResumeLiveStatusMessage({
      attempt: 2,
      retrying: true,
      status: "running",
      stepCount: 4,
      stepNumber: 4,
      summary: "Keeping the tailored resume within the original page count",
    }),
    "Stage 4/4: Keeping the tailored resume within the original page count - Retrying (attempt 2)",
  );
});
