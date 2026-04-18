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

test("buildTailoredResumeDiffRows preserves meaningful shared anchors inside modified spans", () => {
  const rows = buildTailoredResumeDiffRows(
    String.raw`\resumeitem{Led major refactor enabling \textbf{\$50K+/mo in TikTok ad spend} by incorporating TikTok support for our entire suite of software. Refactored \textbf{31K+ LOC in 365 files}, reworking \textbf{140+ tRPC endpoints \& Bayesian inference engine} for platform-agnostic objects}`,
    String.raw`\resumeitem{Led major refactor that enabled \textbf{\$50K+/mo in TikTok ad spend} by adding TikTok support across our suite; refactored \textbf{31K+ LOC in 365 files} and reworked \textbf{140+ tRPC endpoints \& Bayesian inference engine} to create platform-agnostic objects, improving developer onboarding and automation workflows}`,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.type, "modified");
  assert.deepEqual(rows[0]?.originalSegments, [
    { text: "\\resumeitem{Led major refactor ", type: "context" },
    { text: "enabling", type: "removed" },
    {
      text: " \\textbf{\\$50K+/mo in TikTok ad spend} by ",
      type: "context",
    },
    { text: "incorporating", type: "removed" },
    { text: " TikTok support ", type: "context" },
    { text: "for our entire", type: "removed" },
    { text: " suite ", type: "context" },
    { text: "of software. Refactored", type: "removed" },
    { text: " \\textbf{31K+ LOC in 365 files}", type: "context" },
    { text: ", reworking", type: "removed" },
    {
      text: " \\textbf{140+ tRPC endpoints \\& Bayesian inference engine} ",
      type: "context",
    },
    { text: "for", type: "removed" },
    { text: " platform-agnostic objects}", type: "context" },
  ]);
  assert.deepEqual(rows[0]?.modifiedSegments, [
    { text: "\\resumeitem{Led major refactor ", type: "context" },
    { text: "that enabled", type: "added" },
    {
      text: " \\textbf{\\$50K+/mo in TikTok ad spend} by ",
      type: "context",
    },
    { text: "adding", type: "added" },
    { text: " TikTok support ", type: "context" },
    { text: "across", type: "added" },
    { text: " our suite", type: "context" },
    { text: "; refactored", type: "added" },
    { text: " \\textbf{31K+ LOC in 365 files} ", type: "context" },
    { text: "and reworked", type: "added" },
    {
      text: " \\textbf{140+ tRPC endpoints \\& Bayesian inference engine} ",
      type: "context",
    },
    { text: "to create", type: "added" },
    { text: " platform-agnostic objects", type: "context" },
    {
      text: ", improving developer onboarding and automation workflows",
      type: "added",
    },
    { text: "}", type: "context" },
  ]);
});
