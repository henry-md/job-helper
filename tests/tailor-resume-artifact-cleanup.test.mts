import assert from "node:assert/strict";
import test from "node:test";
import {
  isInvalidTailoredResumeArtifact,
  shouldDeleteActiveTailorResumeRun,
  STALE_ACTIVE_TAILOR_RESUME_RUN_MAX_AGE_MS,
} from "../lib/tailor-resume-artifact-cleanup.ts";

test("marks tailored resumes with no preview and no edits as invalid artifacts", () => {
  assert.equal(
    isInvalidTailoredResumeArtifact({
      edits: [],
      pdfUpdatedAt: null,
    }),
    true,
  );

  assert.equal(
    isInvalidTailoredResumeArtifact({
      edits: [
        {
          afterLatexCode: "\\resumeitem{Tailored}",
          beforeLatexCode: "\\resumeitem{Original}",
          command: "resumeitem",
          customLatexCode: null,
          editId: "experience.entry-1.bullet-1:model",
          generatedByStep: 4,
          reason: "Highlights the matching work.",
          segmentId: "experience.entry-1.bullet-1",
          state: "applied",
        },
      ],
      pdfUpdatedAt: null,
    }),
    false,
  );

  assert.equal(
    isInvalidTailoredResumeArtifact({
      edits: [],
      pdfUpdatedAt: "2026-04-25T18:00:00.000Z",
    }),
    false,
  );
});

test("keeps fresh running tailor resume runs", () => {
  const now = Date.parse("2026-04-25T18:00:00.000Z");

  assert.equal(
    shouldDeleteActiveTailorResumeRun({
      hasMatchingInterview: false,
      now,
      status: "RUNNING",
      stepStatus: "running",
      updatedAt: new Date(now - 30_000).toISOString(),
    }),
    false,
  );
});

test("deletes stale running tailor resume runs", () => {
  const now = Date.parse("2026-04-25T18:00:00.000Z");

  assert.equal(
    shouldDeleteActiveTailorResumeRun({
      hasMatchingInterview: false,
      now,
      status: "RUNNING",
      stepStatus: "running",
      updatedAt: new Date(
        now - STALE_ACTIVE_TAILOR_RESUME_RUN_MAX_AGE_MS - 1_000,
      ).toISOString(),
    }),
    true,
  );
});

test("keeps queued running tailor resume runs while another chat is active", () => {
  const now = Date.parse("2026-04-25T18:00:00.000Z");

  assert.equal(
    shouldDeleteActiveTailorResumeRun({
      hasMatchingInterview: true,
      matchingInterviewStatus: "queued",
      now,
      status: "RUNNING",
      stepStatus: "running",
      updatedAt: new Date(
        now - STALE_ACTIVE_TAILOR_RESUME_RUN_MAX_AGE_MS - 60_000,
      ).toISOString(),
    }),
    false,
  );
});

test("keeps claimed question-decision runs while Step 2 is re-evaluating", () => {
  const now = Date.parse("2026-04-25T18:00:00.000Z");

  assert.equal(
    shouldDeleteActiveTailorResumeRun({
      hasMatchingInterview: true,
      matchingInterviewStatus: "deciding",
      now,
      status: "RUNNING",
      stepStatus: "running",
      updatedAt: new Date(
        now - STALE_ACTIVE_TAILOR_RESUME_RUN_MAX_AGE_MS - 60_000,
      ).toISOString(),
    }),
    false,
  );
});

test("deletes active runs stuck on a terminal step", () => {
  const now = Date.parse("2026-04-25T18:00:00.000Z");

  assert.equal(
    shouldDeleteActiveTailorResumeRun({
      hasMatchingInterview: false,
      now,
      status: "RUNNING",
      stepStatus: "failed",
      updatedAt: new Date(now - 60_000).toISOString(),
    }),
    true,
  );
});

test("keeps needs-input runs that still have their interview state", () => {
  const now = Date.parse("2026-04-25T18:00:00.000Z");

  assert.equal(
    shouldDeleteActiveTailorResumeRun({
      hasMatchingInterview: true,
      now,
      status: "NEEDS_INPUT",
      stepStatus: "running",
      updatedAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
    }),
    false,
  );
});

test("deletes needs-input runs that lost their interview state", () => {
  const now = Date.parse("2026-04-25T18:00:00.000Z");

  assert.equal(
    shouldDeleteActiveTailorResumeRun({
      hasMatchingInterview: false,
      now,
      status: "NEEDS_INPUT",
      stepStatus: "running",
      updatedAt: new Date(now - 1_000).toISOString(),
    }),
    true,
  );
});
