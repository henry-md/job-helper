import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  applyTailorResumeBlockChanges,
} from "../lib/tailor-resume-tailoring.ts";
import {
  hasValidTailorResumeSegmentIds,
  normalizeTailorResumeLatex,
  stripTailorResumeSegmentIds,
} from "../lib/tailor-resume-segmentation.ts";

test("applyTailorResumeBlockChanges replaces a segment and re-normalizes ids", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  const updated = applyTailorResumeBlockChanges({
    annotatedLatexCode: normalized.annotatedLatex,
    changes: [
      {
        latexCode: "\\resumeitem{Tailored bullet one}",
        reason: 'Highlights CI/CD work. Matches "CI/CD" in the job description.',
        segmentId: targetSegment.id,
      },
    ],
  });

  assert.equal(hasValidTailorResumeSegmentIds(updated.annotatedLatex), true);

  const strippedLatex = stripTailorResumeSegmentIds(updated.annotatedLatex);

  assert.equal(strippedLatex.includes("Tailored bullet one"), true);
  assert.equal(strippedLatex.includes("Tailored bullet two"), false);
});

test("applyTailorResumeBlockChanges rejects duplicate segment edits", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  assert.throws(
    () =>
      applyTailorResumeBlockChanges({
        annotatedLatexCode: normalized.annotatedLatex,
        changes: [
          {
            latexCode: "\\resumeitem{One}",
            reason: 'Highlights one requirement. Matches "Requirement one".',
            segmentId: targetSegment.id,
          },
          {
            latexCode: "\\resumeitem{Two}",
            reason: 'Highlights another requirement. Matches "Requirement two".',
            segmentId: targetSegment.id,
          },
        ],
      }),
    /duplicate edits/,
  );
});

test("applyTailorResumeBlockChanges rejects unknown segment ids", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);

  assert.throws(
    () =>
      applyTailorResumeBlockChanges({
        annotatedLatexCode: normalized.annotatedLatex,
        changes: [
          {
            latexCode: "\\resumeitem{Tailored bullet}",
            reason: 'Highlights the quoted requirement. Matches "required experience".',
            segmentId: "missing.segment-id",
          },
        ],
      }),
    /unknown segment/,
  );
});

test("applyTailorResumeBlockChanges rejects replacements that span multiple logical blocks", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  assert.throws(
    () =>
      applyTailorResumeBlockChanges({
        annotatedLatexCode: normalized.annotatedLatex,
        changes: [
          {
            latexCode:
              "\\resumeitem{Tailored bullet one}\n\\resumeitem{Tailored bullet two}",
            reason: 'Combines neighboring bullets. Matches "two separate accomplishments".',
            segmentId: targetSegment.id,
          },
        ],
      }),
    /multiple logical blocks/,
  );
});
