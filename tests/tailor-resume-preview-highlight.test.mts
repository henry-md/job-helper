import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import { buildTailoredResumeReviewHighlightedLatex } from "../lib/tailor-resume-preview-highlight.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
} from "../lib/tailor-resume-segmentation.ts";
import type { TailoredResumeBlockEditRecord } from "../lib/tailor-resume-types.ts";

function findSegmentIdBySnippet(annotatedLatexCode: string, snippet: string) {
  const block = readAnnotatedTailorResumeBlocks(annotatedLatexCode).find((candidate) =>
    candidate.latexCode.includes(snippet),
  );

  assert.ok(block, `Expected to find a block containing: ${snippet}`);
  return block.id;
}

function buildSingleEdit(
  segmentId: string,
  beforeLatexCode: string,
  afterLatexCode: string,
) {
  return [
    {
      afterLatexCode,
      beforeLatexCode,
      command: "resumeitem",
      customLatexCode: null,
      editId: `${segmentId}:model`,
      reason: 'Highlights "open-source communities".',
      state: "applied",
      segmentId,
    },
  ] satisfies TailoredResumeBlockEditRecord[];
}

test("highlighted preview groups adjacent modified words into one wrapped highlight run", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const beforeLatexCode =
    String.raw`\resumeitem{Used \textbf{AWS Amplify} to set up \textbf{CI/CD} pipelines, \textbf{reducing design-to-dev handoff time by an avg. of \textasciitilde30\% across 8 teams}}`;
  const afterLatexCode =
    String.raw`\resumeitem{Used \textbf{AWS Amplify} to set up \textbf{CI/CD} pipelines to support contributor onboarding, reducing design-to-dev handoff time by an avg. of \textasciitilde30\% across 8 teams}`;
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Used \\textbf{AWS Amplify} to set up \\textbf{CI/CD} pipelines",
  );

  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    edits: buildSingleEdit(segmentId, beforeLatexCode, afterLatexCode),
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.match(highlightedLatex, /JOBHELPER_REVIEW_HIGHLIGHT_MACROS/);
  assert.match(
    highlightedLatex,
    /\\resumeitem\{Used \\textbf\{AWS Amplify\} to set up \\textbf\{CI\/CD\} pipelines \\jhlmod\{\\jhlmodlead\{\}to support contributor onboarding\}, reducing design-to-dev handoff time by an avg\. of \\textasciitilde30\\% across 8 teams\}/,
  );
  assert.doesNotMatch(
    highlightedLatex,
    /\\jhlmod\{to support\}\s+\\jhlmod\{contributor onboarding\}/,
  );
  assert.match(
    highlightedLatex,
    /\\textbf\{CI\/CD\} pipelines \\jhlmod\{\\jhlmodlead\{\}to support contributor onboarding\}/,
  );
  assert.match(highlightedLatex, /\\jhlmodlead\{\}/);
});

test("highlighted preview coalesces punctuation-only joiners between modified segments", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const beforeLatexCode =
    String.raw`\resumeitem{Built APIs for internal tools and dashboards}`;
  const afterLatexCode =
    String.raw`\resumeitem{Built APIs for internal tools, dashboards, and workflows.}`;
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Used \\textbf{AWS Amplify} to set up \\textbf{CI/CD} pipelines",
  );

  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    edits: buildSingleEdit(segmentId, beforeLatexCode, afterLatexCode),
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.match(
    highlightedLatex,
    /\\resumeitem\{\\jhlmod\{\\jhlmodlead\{\}Built APIs for internal tools, dashboards, and workflows\}\.\}/,
  );
  assert.doesNotMatch(
    highlightedLatex,
    /\\jhlmod\{Built APIs for internal tools,\}\s+\\jhlmod\{dashboards, and workflows\}/,
  );
});

test("highlighted preview groups adjacent replacement words while preserving formatting boundaries", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const beforeLatexCode =
    String.raw`\resumeitem{Created full-stack dashboard for project management with \textbf{React (Next.js) and JavaScript}, with user authentication}`;
  const afterLatexCode =
    String.raw`\resumeitem{Added explicit \textbf{open-source communities} phrasing to show collaboration and contribution to projects}`;
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );

  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    edits: buildSingleEdit(segmentId, beforeLatexCode, afterLatexCode),
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.match(
    highlightedLatex,
    /\\resumeitem\{\\jhlmod\{\\jhlmodlead\{\}Added explicit \}\\textbf\{\\jhlmod\{\\jhlmodlead\{\}open-source communities\}\}\\jhlmod\{\\jhlmodlead\{\} phrasing to show collaboration and contribution to projects\}\}/,
  );
  assert.doesNotMatch(highlightedLatex, /\\jhlmod\{Added\}\s+\\jhlmod\{explicit\}/);
  assert.match(highlightedLatex, /\\textbf\{\\jhlmod\{\\jhlmodlead\{\}open-source communities\}\}/);
});

test("highlighted preview keeps separators highlighted between adjacent formatted chunks", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const beforeLatexCode =
    String.raw`\resumeitem{Built dashboards with authentication}`;
  const afterLatexCode =
    String.raw`\resumeitem{Built \textbf{React} + \textbf{TypeScript} dashboards}`;
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );

  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    edits: buildSingleEdit(segmentId, beforeLatexCode, afterLatexCode),
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.match(
    highlightedLatex,
    /\\resumeitem\{\\jhlmod\{\\jhlmodlead\{\}Built \}\\textbf\{\\jhlmod\{\\jhlmodlead\{\}React\}\}\\jhlmod\{\\jhlmodlead\{\} \+ \}\\textbf\{\\jhlmod\{\\jhlmodlead\{\}TypeScript\}\}\\jhlmod\{\\jhlmodlead\{\} dashboards\}\}/,
  );
  assert.doesNotMatch(highlightedLatex, /\\textbf\{\\jhlmod\{React\}\}\s+\+\s+\\textbf/);
});

test("highlighted preview bridges punctuation between formatted chunks", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const beforeLatexCode = String.raw`\resumeitem{Built dashboards}`;
  const afterLatexCode =
    String.raw`\resumeitem{\textbf{React}, \textbf{TypeScript}, and \textbf{Node.js} dashboards}`;
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );

  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    edits: buildSingleEdit(segmentId, beforeLatexCode, afterLatexCode),
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.match(
    highlightedLatex,
    /\\resumeitem\{\\textbf\{React\}\\jhlmod\{\\jhlmodlead\{\}, \}\\textbf\{\\jhlmod\{\\jhlmodlead\{\}TypeScript\}\}\\jhlmod\{\\jhlmodlead\{\}, and \}\\textbf\{\\jhlmod\{\\jhlmodlead\{\}Node\.js\}\}\\jhlmod\{\\jhlmodlead\{\} dashboards\}\}/,
  );
});

test("highlighted preview keeps escaped punctuation inside one highlight run", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const beforeLatexCode = String.raw`\resumeitem{Improved release process}`;
  const afterLatexCode =
    String.raw`\resumeitem{Improved release process (CI/CD, avg. \textasciitilde30\% faster).}`;
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );

  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    edits: buildSingleEdit(segmentId, beforeLatexCode, afterLatexCode),
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.match(
    highlightedLatex,
    /\\jhlmod\{\\jhlmodlead\{\}Improved release process \(CI\/CD, avg\. \\textasciitilde30\\% faster\)\.\}/,
  );
  assert.doesNotMatch(
    highlightedLatex,
    /\\jhlmod\{\(CI\/CD, avg\.\s*\}\s*\\textasciitilde\s*\\jhlmod\{30/,
  );
});

test("highlighted preview leaves untouched blocks unchanged", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const beforeLatexCode =
    String.raw`\resumeitem{Used \textbf{AWS Amplify} to set up \textbf{CI/CD} pipelines, \textbf{reducing design-to-dev handoff time by an avg. of \textasciitilde30\% across 8 teams}}`;
  const afterLatexCode =
    String.raw`\resumeitem{Used \textbf{AWS Amplify} to set up \textbf{CI/CD} pipelines to support contributor onboarding, reducing design-to-dev handoff time by an avg. of \textasciitilde30\% across 8 teams}`;
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Used \\textbf{AWS Amplify} to set up \\textbf{CI/CD} pipelines",
  );

  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    edits: buildSingleEdit(segmentId, beforeLatexCode, afterLatexCode),
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.match(
    highlightedLatex,
    /\\resumeitem\{Created full-stack dashboard for project management with \\textbf\{React \(Next\.js\) and JavaScript\}, with user authentication\}/,
  );
  assert.match(
    highlightedLatex,
    /\\descline\{Built full-stack disaster relief analytics platform for the National Institute of Standards and Technology \(NIST\)\}/,
  );
  assert.doesNotMatch(highlightedLatex, /JOBHELPER_SEGMENT_ID/);
});

test("highlighted preview combines model and user edits on the same segment", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const highlightedLatex = buildTailoredResumeReviewHighlightedLatex({
    annotatedLatexCode:
      "% JOBHELPER_SEGMENT_ID: experience.entry-1.bullet-1\n\\resumeitem{User-revised open-source collaboration bullet}",
    edits: [
      {
        afterLatexCode:
          "\\resumeitem{Added explicit open-source collaboration bullet}",
        beforeLatexCode:
          "\\resumeitem{Created full-stack dashboard for project management with \\textbf{React (Next.js) and JavaScript}, with user authentication}",
        command: "resumeitem",
        customLatexCode:
          "\\resumeitem{User-revised open-source collaboration bullet}",
        editId: `${segmentId}:model`,
        reason: "Model edit.",
        state: "applied",
        segmentId,
      },
    ],
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.match(
    highlightedLatex,
    /\\resumeitem\{\\jhlmod\{\\jhlmodlead\{\}User-revised open-source collaboration bullet\}\}/,
  );
  assert.doesNotMatch(
    highlightedLatex,
    /\\resumeitem\{\\jhlmod\{Added explicit open-source collaboration bullet\}\}/,
  );
});
