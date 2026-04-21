import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTailoredResumeEditToSourceLatex,
  buildTailoredResumeReviewEdits,
  buildTailoredResumeCombinedActiveEdits,
  rebuildTailoredResumeAnnotatedLatex,
  resolveTailoredResumeSourceAnnotatedLatex,
  updateTailoredResumeEditState,
} from "../lib/tailor-resume-edit-history.ts";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
} from "../lib/tailor-resume-segmentation.ts";

function findBlockBySnippet(annotatedLatexCode: string, snippet: string) {
  const block = readAnnotatedTailorResumeBlocks(annotatedLatexCode).find((candidate) =>
    candidate.latexCode.includes(snippet),
  );

  assert.ok(block, `Expected to find a block containing: ${snippet}`);
  return block;
}

function replaceBlockInAnnotatedLatex(input: {
  annotatedLatexCode: string;
  replacementLatexCode: string;
  segmentId: string;
}) {
  const blocks = readAnnotatedTailorResumeBlocks(input.annotatedLatexCode);
  const targetBlock = blocks.find((block) => block.id === input.segmentId);

  assert.ok(targetBlock, `Expected to find block ${input.segmentId}`);

  return (
    input.annotatedLatexCode.slice(0, targetBlock.contentStart) +
    input.replacementLatexCode +
    input.annotatedLatexCode.slice(targetBlock.contentEnd)
  );
}

test("combined active edits collapse model and user history into the final diff", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const combinedEdits = buildTailoredResumeCombinedActiveEdits({
    annotatedLatexCode:
      "% JOBHELPER_SEGMENT_ID: experience.entry-1.bullet-1\n\\resumeitem{User-revised open-source collaboration bullet}",
    edits: [
      {
        afterLatexCode:
          "\\resumeitem{Added explicit open-source collaboration bullet}",
        beforeLatexCode: sourceBlock.latexCode,
        command: "resumeitem",
        customLatexCode:
          "\\resumeitem{User-revised open-source collaboration bullet}",
        editId: `${sourceBlock.id}:model`,
        reason: "Model edit",
        state: "applied",
        segmentId: sourceBlock.id,
      },
    ],
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.equal(combinedEdits.length, 1);
  assert.equal(combinedEdits[0]?.beforeLatexCode, sourceBlock.latexCode);
  assert.equal(
    combinedEdits[0]?.afterLatexCode,
    "\\resumeitem{User-revised open-source collaboration bullet}",
  );
  assert.equal(combinedEdits[0]?.reason, "Model edit");
});

test("review edits keep the original model block visible when the user customizes it", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const reviewEdits = buildTailoredResumeReviewEdits({
    edits: [
      {
        afterLatexCode:
          "\\resumeitem{Added explicit open-source collaboration bullet}",
        beforeLatexCode: sourceBlock.latexCode,
        command: "resumeitem",
        customLatexCode:
          "\\resumeitem{User-revised open-source collaboration bullet}",
        editId: `${sourceBlock.id}:model`,
        reason: "Model edit",
        state: "applied",
        segmentId: sourceBlock.id,
      },
    ],
  });

  assert.equal(reviewEdits.length, 1);
  assert.equal(reviewEdits[0]?.editId, `${sourceBlock.id}:model`);
  assert.equal(
    reviewEdits[0]?.afterLatexCode,
    "\\resumeitem{Added explicit open-source collaboration bullet}",
  );
  assert.equal(
    reviewEdits[0]?.customLatexCode,
    "\\resumeitem{User-revised open-source collaboration bullet}",
  );
});

test("changing the model choice clears user overrides for the same segment", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const nextEdits = updateTailoredResumeEditState({
    editId: `${sourceBlock.id}:model`,
    edits: [
      {
        afterLatexCode:
          "\\resumeitem{Added explicit open-source collaboration bullet}",
        beforeLatexCode: sourceBlock.latexCode,
        command: "resumeitem",
        customLatexCode:
          "\\resumeitem{User-revised open-source collaboration bullet}",
        editId: `${sourceBlock.id}:model`,
        reason: "Model edit",
        state: "applied",
        segmentId: sourceBlock.id,
      },
    ],
    nextState: "rejected",
  });

  assert.ok(nextEdits);
  assert.equal(
    nextEdits?.find((edit) => edit.editId === `${sourceBlock.id}:model`)?.state,
    "rejected",
  );
  assert.equal(
    nextEdits?.find((edit) => edit.editId === `${sourceBlock.id}:model`)
      ?.customLatexCode,
    null,
  );
});

test("rebuilding tailored resume latex drops rejected edits from the effective document", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const rebuiltAnnotatedLatex = rebuildTailoredResumeAnnotatedLatex({
    annotatedLatexCode:
      "% JOBHELPER_SEGMENT_ID: experience.entry-1.bullet-1\n\\resumeitem{Added explicit open-source collaboration bullet}",
    edits: [
      {
        afterLatexCode:
          "\\resumeitem{Added explicit open-source collaboration bullet}",
        beforeLatexCode: sourceBlock.latexCode,
        command: "resumeitem",
        customLatexCode: null,
        editId: `${sourceBlock.id}:model`,
        reason: "Model edit",
        state: "rejected",
        segmentId: sourceBlock.id,
      },
    ],
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.match(
    rebuiltAnnotatedLatex,
    /Created full-stack dashboard for project management with \\textbf\{React \(Next\.js\) and JavaScript\}, with user authentication/,
  );
  assert.doesNotMatch(
    rebuiltAnnotatedLatex,
    /Added explicit open-source collaboration bullet/,
  );
});

test("source annotated latex falls back by reversing the earliest edit on legacy records", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const sourceAnnotatedLatex = resolveTailoredResumeSourceAnnotatedLatex({
    annotatedLatexCode: replaceBlockInAnnotatedLatex({
      annotatedLatexCode: normalized.annotatedLatex,
      replacementLatexCode:
        "\\resumeitem{Added explicit open-source collaboration bullet}",
      segmentId: sourceBlock.id,
    }),
    edits: [
      {
        afterLatexCode:
          "\\resumeitem{Added explicit open-source collaboration bullet}",
        beforeLatexCode: sourceBlock.latexCode,
        command: "resumeitem",
        customLatexCode: null,
        editId: `${sourceBlock.id}:model`,
        reason: "Model edit",
        state: "applied",
        segmentId: sourceBlock.id,
      },
    ],
    sourceAnnotatedLatexCode: null,
  });

  assert.match(
    sourceAnnotatedLatex,
    /Created full-stack dashboard for project management with \\textbf\{React \(Next\.js\) and JavaScript\}, with user authentication/,
  );
});

test("applying a tailored edit to source latex replaces the matching source block", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const result = applyTailoredResumeEditToSourceLatex({
    beforeLatexCode: sourceBlock.latexCode,
    replacementLatexCode:
      "\\resumeitem{Added explicit open-source collaboration bullet}",
    segmentId: sourceBlock.id,
    sourceLatexCode: tailorResumeLatexExample,
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.match(
    result.latexCode,
    /Added explicit open-source collaboration bullet/,
  );
  assert.doesNotMatch(
    result.latexCode,
    /Created full-stack dashboard for project management/,
  );
});

test("applying a tailored edit to source latex refuses stale source blocks", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const staleSourceLatex = replaceBlockInAnnotatedLatex({
    annotatedLatexCode: normalized.annotatedLatex,
    replacementLatexCode:
      "\\resumeitem{Existing source edit that should not be overwritten}",
    segmentId: sourceBlock.id,
  });
  const result = applyTailoredResumeEditToSourceLatex({
    beforeLatexCode: sourceBlock.latexCode,
    replacementLatexCode:
      "\\resumeitem{Added explicit open-source collaboration bullet}",
    segmentId: sourceBlock.id,
    sourceLatexCode: staleSourceLatex,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "source_block_changed");
});
