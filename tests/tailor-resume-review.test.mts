import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  buildTailoredResumeBlockEdits,
  buildTailoredResumeDiffRows,
  normalizeTailoredResumeEditReason,
} from "../lib/tailor-resume-review.ts";
import { normalizeTailorResumeLatex } from "../lib/tailor-resume-segmentation.ts";

test("buildTailoredResumeBlockEdits snapshots before and after LaTeX by segment", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const targetSegment = normalized.segments.find((segment) =>
    segment.id.includes(".bullet-1"),
  );

  assert.ok(targetSegment);

  const edits = buildTailoredResumeBlockEdits({
    annotatedLatexCode: normalized.annotatedLatex,
    changes: [
      {
        latexCode: "\\resumeitem{Tailored bullet one}",
        reason: 'Highlights CI/CD work. Matches "CI/CD" in the job description.',
        segmentId: targetSegment.id,
      },
    ],
  });

  assert.equal(edits.length, 1);
  assert.equal(edits[0]?.segmentId, targetSegment.id);
  assert.equal(edits[0]?.command, "resumeitem");
  assert.equal(edits[0]?.editId, `${targetSegment.id}:model`);
  assert.equal(edits[0]?.beforeLatexCode.includes("\\resumeitem"), true);
  assert.equal(edits[0]?.afterLatexCode, "\\resumeitem{Tailored bullet one}");
  assert.equal(edits[0]?.source, "model");
  assert.equal(edits[0]?.state, "applied");
});

test("normalizeTailoredResumeEditReason trims reasons to at most two sentences", () => {
  assert.equal(
    normalizeTailoredResumeEditReason(
      'Highlights CI/CD work. Matches "CI/CD" in the job description. Third sentence.',
    ),
    'Highlights CI/CD work. Matches "CI/CD" in the job description.',
  );
});

test("buildTailoredResumeDiffRows pairs nearby removals and additions as modified rows", () => {
  const rows = buildTailoredResumeDiffRows(
    "\\resumeitem{Original bullet}",
    "\\resumeitem{Tailored bullet}",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.type, "modified");
  assert.equal(rows[0]?.originalText, "\\resumeitem{Original bullet}");
  assert.equal(rows[0]?.modifiedText, "\\resumeitem{Tailored bullet}");
  assert.deepEqual(rows[0]?.originalSegments, [
    { text: "\\resumeitem{", type: "context" },
    { text: "Original", type: "removed" },
    { text: " bullet}", type: "context" },
  ]);
  assert.deepEqual(rows[0]?.modifiedSegments, [
    { text: "\\resumeitem{", type: "context" },
    { text: "Tailored", type: "added" },
    { text: " bullet}", type: "context" },
  ]);
});

test("buildTailoredResumeDiffRows coalesces long modified ranges into one inline highlight span", () => {
  const rows = buildTailoredResumeDiffRows(
    String.raw`\resumeitem{Created full-stack dashboard for project management with \textbf{React (Next.js) and JavaScript}, with user authentication}`,
    String.raw`\resumeitem{Used \textbf{AWS Amplify} to set up \textbf{CI/CD} pipelines to support contributor onboarding, reducing design-to-dev handoff time by an avg. of \textasciitilde30\% across 8 teams}`,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.type, "modified");
  assert.deepEqual(rows[0]?.originalSegments, [
    { text: "\\resumeitem{", type: "context" },
    {
      text:
        "Created full-stack dashboard for project management with \\textbf{React (Next.js) and JavaScript}, with user authentication",
      type: "removed",
    },
    { text: "}", type: "context" },
  ]);
  assert.deepEqual(rows[0]?.modifiedSegments, [
    { text: "\\resumeitem{", type: "context" },
    {
      text:
        "Used \\textbf{AWS Amplify} to set up \\textbf{CI/CD} pipelines to support contributor onboarding, reducing design-to-dev handoff time by an avg. of \\textasciitilde30\\% across 8 teams",
      type: "added",
    },
    { text: "}", type: "context" },
  ]);
});
