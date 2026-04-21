import assert from "node:assert/strict";
import test from "node:test";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import { measureTailorResumeLayout } from "../lib/tailor-resume-layout-measurement.ts";
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

test("measureTailorResumeLayout counts rendered lines for in-context replacements", async () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const segmentId = findSegmentIdBySnippet(
    normalized.annotatedLatex,
    "Led major refactor enabling",
  );
  const sourceLayout = await measureTailorResumeLayout({
    annotatedLatexCode: normalized.annotatedLatex,
  });
  const sourceLineCount = sourceLayout.segments.find(
    (segment) => segment.segmentId === segmentId,
  )?.lineCount;

  assert.equal(typeof sourceLineCount, "number");
  assert.ok((sourceLineCount ?? 0) > 1);

  const compacted = applyTailorResumeBlockChanges({
    annotatedLatexCode: normalized.annotatedLatex,
    changes: [
      {
        latexCode:
          String.raw`\resumeitem{Led TikTok refactor enabling \textbf{\$50K+/mo in ad spend} across the software suite.}`,
        reason: "Keeps the strongest metric while removing detail that pushed the bullet onto another line.",
        segmentId,
      },
    ],
  });
  const compactedLayout = await measureTailorResumeLayout({
    annotatedLatexCode: compacted.annotatedLatex,
  });
  const compactedLineCount = compactedLayout.segments.find(
    (segment) => segment.segmentId === segmentId,
  )?.lineCount;

  assert.equal(typeof compactedLineCount, "number");
  assert.ok(
    (compactedLineCount ?? Number.POSITIVE_INFINITY) < (sourceLineCount ?? 0),
  );
});
