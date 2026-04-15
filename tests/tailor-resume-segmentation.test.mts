import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  buildUniqueTailorResumeSegmentId,
  hasValidTailorResumeSegmentIds,
  normalizeTailorResumeLatex,
  stripTailorResumeSegmentIds,
} from "../lib/tailor-resume-segmentation.ts";

test("normalizeTailorResumeLatex injects deterministic segment ids", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);

  assert.equal(normalized.segmentCount > 0, true);
  assert.equal(
    normalized.annotatedLatex.includes("% JOBHELPER_SEGMENT_ID:"),
    true,
  );
  assert.equal(hasValidTailorResumeSegmentIds(normalized.annotatedLatex), true);
  assert.equal(
    normalized.annotatedLatex.includes(
      "% JOBHELPER_SEGMENT_ID: document.documentclass-article-1",
    ),
    true,
  );
  assert.equal(
    normalized.annotatedLatex.includes(
      "% JOBHELPER_SEGMENT_ID: document.usepackage-geometry-1",
    ),
    true,
  );
  assert.equal(
    stripTailorResumeSegmentIds(normalized.annotatedLatex).includes(
      "\\resumeSection{WORK EXPERIENCE}",
    ),
    true,
  );
});

test("normalizeTailorResumeLatex is stable across re-normalization", () => {
  const firstPass = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const secondPass = normalizeTailorResumeLatex(firstPass.annotatedLatex);

  assert.equal(secondPass.annotatedLatex, firstPass.annotatedLatex);
  assert.equal(secondPass.segmentCount, firstPass.segmentCount);
});

test("buildUniqueTailorResumeSegmentId appends numeric suffixes on conflict", () => {
  const seenSegmentIds = new Set<string>();

  assert.equal(
    buildUniqueTailorResumeSegmentId("work-experience.entry-1.bullet-2", seenSegmentIds),
    "work-experience.entry-1.bullet-2",
  );
  assert.equal(
    buildUniqueTailorResumeSegmentId("work-experience.entry-1.bullet-2", seenSegmentIds),
    "work-experience.entry-1.bullet-2-2",
  );
  assert.equal(
    buildUniqueTailorResumeSegmentId("work-experience.entry-1.bullet-2", seenSegmentIds),
    "work-experience.entry-1.bullet-2-3",
  );
});
