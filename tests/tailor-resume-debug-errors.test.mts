import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTailorResumeDebugErrorSource,
  formatTailorResumeDebugPayloadLabel,
  formatTailorResumeDebugErrorSource,
  parseTailorResumeInvalidReplacementPayload,
  tailorResumeDebugErrorSources,
} from "../lib/tailor-resume-debug-errors.ts";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  buildInvalidTailorResumeReplacementLogPayload,
} from "../lib/tailor-resume-tailoring.ts";
import { normalizeTailorResumeLatex } from "../lib/tailor-resume-segmentation.ts";

test("classifyTailorResumeDebugErrorSource separates invalid replacements from bad latex generations", () => {
  assert.equal(
    classifyTailorResumeDebugErrorSource(
      tailorResumeDebugErrorSources.tailoringInvalidReplacement,
    ),
    "invalid_replacement",
  );
  assert.equal(
    classifyTailorResumeDebugErrorSource(
      tailorResumeDebugErrorSources.extractionCompileFailure,
    ),
    "bad_latex_generation",
  );
  assert.equal(
    classifyTailorResumeDebugErrorSource("tailoring"),
    "bad_latex_generation",
  );
});

test("debug error labels stay human readable", () => {
  assert.equal(
    formatTailorResumeDebugErrorSource(
      tailorResumeDebugErrorSources.tailoringCompileFailure,
    ),
    "Tailoring compile failure",
  );
  assert.equal(
    formatTailorResumeDebugPayloadLabel(
      tailorResumeDebugErrorSources.tailoringInvalidReplacement,
    ),
    "Rejected payload",
  );
});

test("buildInvalidTailorResumeReplacementLogPayload captures the rejected replacement and annotated source", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  const payload = buildInvalidTailorResumeReplacementLogPayload({
    annotatedLatexCode: normalized.annotatedLatex,
    candidate: {
      changes: [
        {
          latexCode:
            "\\resumeitem{Tailored bullet one}\n\\resumeitem{Tailored bullet two}",
          reason: 'Combines neighboring bullets. Matches "two separate accomplishments".',
          segmentId: targetSegment.id,
        },
      ],
      companyName: "OpenAI",
      displayName: "OpenAI - Research Engineer",
      jobIdentifier: "Applied research",
      positionTitle: "Research Engineer",
      thesis: {
        jobDescriptionFocus: "Focuses on platform delivery and strong engineering rigor.",
        resumeChanges: "Raises the most relevant bullet and reframes delivery impact.",
      },
    },
    error: `Replacement for segment ${targetSegment.id} spans multiple logical blocks.`,
  });

  assert.equal(
    payload.includes("Tailor Resume invalid replacement"),
    true,
  );
  assert.equal(payload.includes(targetSegment.id), true);
  assert.equal(payload.includes("Original block:"), true);
  assert.equal(payload.includes("Replacement block:"), true);
  assert.equal(payload.includes("Annotated source LaTeX:"), true);
  assert.equal(payload.includes("% JOBHELPER_SEGMENT_ID:"), true);
  assert.equal(payload.includes("Tailored bullet two"), true);
});

test("parseTailorResumeInvalidReplacementPayload reconstructs rejected changes from the logged payload", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  const payload = buildInvalidTailorResumeReplacementLogPayload({
    annotatedLatexCode: normalized.annotatedLatex,
    candidate: {
      changes: [
        {
          latexCode:
            "\\resumeitem{Tailored bullet one}\n\\resumeitem{Tailored bullet two}",
          reason: "Combines adjacent bullets into one response.",
          segmentId: targetSegment.id,
        },
      ],
      companyName: "OpenAI",
      displayName: "OpenAI - Research Engineer",
      jobIdentifier: "Applied research",
      positionTitle: "Research Engineer",
      thesis: {
        jobDescriptionFocus: "The role over-indexes on platform delivery.",
        resumeChanges: "Elevate delivery-focused bullets and compress generic ones.",
      },
    },
    error: `Replacement for segment ${targetSegment.id} spans multiple logical blocks.`,
  });

  const parsed = parseTailorResumeInvalidReplacementPayload(payload);

  assert.ok(parsed);
  assert.equal(
    parsed.validationError,
    `Replacement for segment ${targetSegment.id} spans multiple logical blocks.`,
  );
  assert.equal(parsed.structuredResponse?.companyName, "OpenAI");
  assert.equal(
    parsed.structuredResponse?.thesis?.jobDescriptionFocus,
    "The role over-indexes on platform delivery.",
  );
  assert.equal(parsed.changes.length, 1);
  assert.equal(parsed.changes[0]?.segmentId, targetSegment.id);
  assert.equal(
    parsed.changes[0]?.replacementLatexCode.includes("Tailored bullet two"),
    true,
  );
  assert.equal(
    parsed.changes[0]?.sourceLatexCode?.includes("\\resumeitem"),
    true,
  );
});

test("parseTailorResumeInvalidReplacementPayload ignores unrelated payloads", () => {
  assert.equal(parseTailorResumeInvalidReplacementPayload("nope"), null);
});
