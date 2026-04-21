import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import { measureTailorResumeLayout } from "../lib/tailor-resume-layout-measurement.ts";
import { measureTailorResumeLineReductionCandidates } from "../lib/tailor-resume-line-reduction-candidates.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
} from "../lib/tailor-resume-segmentation.ts";
import { applyTailorResumeBlockChanges } from "../lib/tailor-resume-tailoring.ts";

function findSegmentIdBySnippet(annotatedLatexCode: string, snippet: string) {
  const block = readAnnotatedTailorResumeBlocks(annotatedLatexCode).find((candidate) =>
    candidate.latexCode.includes(snippet),
  );

  assert.ok(block, `Expected to find a block containing: ${snippet}`);
  return block.id;
}

async function buildLineReductionFixture() {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Led major refactor enabling",
  );
  const sourceLayout = await measureTailorResumeLayout({
    annotatedLatexCode: normalized.annotatedLatex,
  });
  const current = applyTailorResumeBlockChanges({
    annotatedLatexCode: normalized.annotatedLatex,
    changes: [
      {
        latexCode:
          String.raw`\resumeitem{Led major refactor that enabled \textbf{\$50K+/mo in TikTok ad spend} by adding TikTok support across the full software suite; refactored \textbf{31K+ LOC (365 files)} and \textbf{140+ tRPC endpoints \& Bayesian inference engine} into platform-agnostic objects, improving maintainability, diagnosability, service reliability, onboarding speed, and cross-team developer experience for platform teams.}`,
        reason: "Long current Step 3 replacement.",
        segmentId,
      },
    ],
  });
  const currentLayout = await measureTailorResumeLayout({
    annotatedLatexCode: current.annotatedLatex,
  });
  const originalLineCount = sourceLayout.segments.find(
    (segment) => segment.segmentId === segmentId,
  )?.lineCount;
  const currentLineCount = currentLayout.segments.find(
    (segment) => segment.segmentId === segmentId,
  )?.lineCount;

  assert.equal(typeof originalLineCount, "number");
  assert.equal(typeof currentLineCount, "number");
  assert.ok(
    (currentLineCount ?? 0) > (originalLineCount ?? Number.POSITIVE_INFINITY),
  );

  return {
    currentAnnotatedLatexCode: current.annotatedLatex,
    currentLayout,
    editableSegmentIds: new Set([segmentId]),
    segmentId,
    sourceLayout,
  };
}

test("line reduction gate rejects candidates that do not beat the original rendered line count", async () => {
  const fixture = await buildLineReductionFixture();
  const result = await measureTailorResumeLineReductionCandidates({
    candidates: [
      {
        latexCode:
          String.raw`\resumeitem{Led major refactor that enabled \textbf{\$50K+/mo in TikTok ad spend} by adding TikTok support; refactored \textbf{31K+ LOC (365 files)} and \textbf{140+ tRPC endpoints \& Bayesian inference engine} into platform-agnostic objects, improving maintainability and diagnosability.}`,
        reason:
          "Adds maintainability and diagnosability framing for the role, while trimming the longer draft.",
        segmentId: fixture.segmentId,
      },
    ],
    currentAnnotatedLatexCode: fixture.currentAnnotatedLatexCode,
    currentLayout: fixture.currentLayout,
    editableSegmentIds: fixture.editableSegmentIds,
    sourceLayout: fixture.sourceLayout,
  });

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(
    result.rejected[0]?.rejectionReason,
    "candidate_did_not_reduce_original_rendered_line_count",
  );
  assert.equal(result.rejected[0]?.candidateLineCount, 2);
  assert.equal(result.rejected[0]?.originalLineCount, 2);
});

test("line reduction gate accepts candidates with a user-visible rendered line reduction", async () => {
  const fixture = await buildLineReductionFixture();
  const result = await measureTailorResumeLineReductionCandidates({
    candidates: [
      {
        latexCode:
          String.raw`\resumeitem{Led TikTok refactor enabling \textbf{\$50K+/mo in ad spend} across the software suite.}`,
        reason:
          "Keeps the TikTok monetization metric central for the role, while trimming the block.",
        segmentId: fixture.segmentId,
      },
    ],
    currentAnnotatedLatexCode: fixture.currentAnnotatedLatexCode,
    currentLayout: fixture.currentLayout,
    editableSegmentIds: fixture.editableSegmentIds,
    sourceLayout: fixture.sourceLayout,
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted[0]?.candidateLineCount, 1);
  assert.equal(result.accepted[0]?.originalLineCount, 2);
  assert.ok(
    (result.accepted[0]?.previousLineCount ?? 0) >
      (result.accepted[0]?.candidateLineCount ?? Number.POSITIVE_INFINITY),
  );
});
