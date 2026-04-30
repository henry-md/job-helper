import assert from "node:assert/strict";
import test from "node:test";
import { applyTailorResumePageCountFailure } from "../lib/tailor-resume-page-count-failure.ts";
import type { GenerateTailoredResumeResult } from "../lib/tailor-resume-tailoring.ts";

function buildGenerationResult(
  overrides: Partial<GenerateTailoredResumeResult> = {},
): GenerateTailoredResumeResult {
  return {
    annotatedLatexCode: "% annotated",
    attempts: 1,
    companyName: "OpenAI",
    displayName: "OpenAI - Research Engineer",
    edits: [],
    generationDurationMs: 123,
    jobIdentifier: "REQ-123",
    latexCode: "\\documentclass{article}",
    model: "gpt-5-mini",
    openAiDebug: {
      implementation: {
        outputJson: "{}",
        prompt: "implementation prompt",
        skippedReason: null,
      },
      planning: {
        outputJson: "{}",
        prompt: "planning prompt",
        skippedReason: null,
      },
    },
    outcome: "success",
    planningResult: {
      changes: [],
      companyName: "OpenAI",
      displayName: "OpenAI - Research Engineer",
      jobIdentifier: "REQ-123",
      positionTitle: "Research Engineer",
      questioningSummary: null,
      thesis: {
        jobDescriptionFocus: "Focus",
        resumeChanges: "Changes",
      },
    },
    positionTitle: "Research Engineer",
    previewPdf: Buffer.from("pdf"),
    savedLinkUpdateCount: 0,
    savedLinkUpdates: [],
    thesis: {
      jobDescriptionFocus: "Focus",
      resumeChanges: "Changes",
    },
    validationError: null,
    ...overrides,
  };
}

test("page-count compaction failure hard-fails even with a preview PDF", () => {
  const result = buildGenerationResult();
  const updated = applyTailorResumePageCountFailure(
    result,
    "No proposed compaction candidate reduced its block's measured rendered line count.",
  );

  assert.equal(updated.outcome, "generation_failure");
  assert.equal(
    updated.validationError,
    "Step 4: No proposed compaction candidate reduced its block's measured rendered line count.",
  );
  assert.ok(updated.previewPdf);
});

test("page-count compaction failure still hard-fails when no preview exists", () => {
  const result = buildGenerationResult({
    outcome: "reviewable_failure",
    previewPdf: null,
  });
  const updated = applyTailorResumePageCountFailure(
    result,
    "Unable to compare the tailored resume page count.",
  );

  assert.equal(updated.outcome, "generation_failure");
  assert.equal(
    updated.validationError,
    "Step 4: Unable to compare the tailored resume page count.",
  );
  assert.equal(updated.previewPdf, null);
});
