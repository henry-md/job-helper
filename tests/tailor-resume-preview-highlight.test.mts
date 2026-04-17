import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import { buildTailoredResumeReviewHighlightedLatex } from "../lib/tailor-resume-preview-highlight.ts";
import { normalizeTailorResumeLatex } from "../lib/tailor-resume-segmentation.ts";

test("buildTailoredResumeReviewHighlightedLatex swaps the selected bullet into a highlighted variant", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const selectedSegmentId = "work-experience.entry-1.bullet-1";

  assert.equal(
    normalized.segments.some((segment) => segment.id === selectedSegmentId),
    true,
  );

  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    segmentId: selectedSegmentId,
  });

  assert.match(highlightedLatex, /JOBHELPER_REVIEW_HIGHLIGHT_MACROS/);
  assert.doesNotMatch(highlightedLatex, /JOBHELPER_SEGMENT_ID/);
  assert.match(
    highlightedLatex,
    /\\jobhelperHighlightedResumeitem\{Conceived and led ad similarity detection service/,
  );
  assert.match(
    highlightedLatex,
    /\\resumeitem\{Led major refactor enabling \\textbf\{\\\$50K\+\/mo in TikTok ad spend\}/,
  );
});

test("buildTailoredResumeReviewHighlightedLatex wraps top-level brace blocks without altering neighbors", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const selectedSegmentId = "technical-skills.block-full-stack-web-dev-1";

  assert.equal(
    normalized.segments.some((segment) => segment.id === selectedSegmentId),
    true,
  );

  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    segmentId: selectedSegmentId,
  });

  assert.match(
    highlightedLatex,
    /\{\s*\\jobhelperReviewMark\\color\{JobHelperReviewAccent\}/,
  );
  assert.match(highlightedLatex, /\\textbf\{Full-Stack Web Dev:/);
  assert.match(highlightedLatex, /\\textbf\{Languages:/);
});

test("buildTailoredResumeReviewHighlightedLatex throws when the selected segment is missing", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);

  assert.throws(
    () =>
      buildTailoredResumeReviewHighlightedLatex({
        annotatedLatexCode: normalized.annotatedLatex,
        segmentId: "missing.segment",
      }),
    /Unable to locate the selected tailored resume segment/,
  );
});
