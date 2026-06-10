import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTailoredResumeEditToSourceLatex,
  buildTailoredResumeSnapshotComparisonEdits,
  buildTailoredResumeReviewEdits,
  buildTailoredResumeCombinedActiveEdits,
  deleteTailoredResumeEdit,
  rebuildTailoredResumeAnnotatedLatex,
  resolveTailoredResumeSourceAnnotatedLatex,
  updateTailoredResumeEditState,
} from "../lib/tailor-resume-edit-history.ts";
import { tailorResumeLatexExample } from "../lib/tailor-resume-latex-example.ts";
import {
  normalizeTailorResumeLatex,
  readAnnotatedTailorResumeBlocks,
  stripTailorResumeSegmentIds,
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

test("deleting a model edit removes its tailored block from the rebuilt resume", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const editId = `${sourceBlock.id}:model`;
  const editedLatexCode =
    "\\resumeitem{Added explicit open-source collaboration bullet}";
  const nextEdits = deleteTailoredResumeEdit({
    editId,
    edits: [
      {
        afterLatexCode: editedLatexCode,
        beforeLatexCode: sourceBlock.latexCode,
        command: "resumeitem",
        customLatexCode: null,
        editId,
        reason: "Model edit",
        state: "applied",
        segmentId: sourceBlock.id,
      },
    ],
  });

  assert.deepEqual(nextEdits, []);

  const rebuiltAnnotatedLatex = rebuildTailoredResumeAnnotatedLatex({
    annotatedLatexCode: replaceBlockInAnnotatedLatex({
      annotatedLatexCode: normalized.annotatedLatex,
      replacementLatexCode: editedLatexCode,
      segmentId: sourceBlock.id,
    }),
    edits: nextEdits ?? [],
    sourceAnnotatedLatexCode: normalized.annotatedLatex,
  });

  assert.doesNotMatch(rebuiltAnnotatedLatex, /open-source collaboration bullet/);
  assert.match(
    rebuiltAnnotatedLatex,
    /Created full-stack dashboard for project management/,
  );
});

test("deleting a user edit removes only that user-authored edit", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const firstBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const secondBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Developed a \\textbf{Python and SQL} backend",
  );
  const userEditId = `${firstBlock.id}:user`;
  const modelEditId = `${secondBlock.id}:model`;
  const nextEdits = deleteTailoredResumeEdit({
    editId: userEditId,
    edits: [
      {
        afterLatexCode: "\\resumeitem{User-authored replacement bullet}",
        beforeLatexCode: firstBlock.latexCode,
        command: "resumeitem",
        customLatexCode: null,
        editId: userEditId,
        generatedByStep: 4,
        reason: "User edit",
        source: "user",
        state: "applied",
        segmentId: firstBlock.id,
      },
      {
        afterLatexCode: "\\resumeitem{Model-authored replacement bullet}",
        beforeLatexCode: secondBlock.latexCode,
        command: "resumeitem",
        customLatexCode: null,
        editId: modelEditId,
        reason: "Model edit",
        state: "applied",
        segmentId: secondBlock.id,
      },
    ],
  });

  assert.equal(nextEdits?.length, 1);
  assert.equal(nextEdits?.[0]?.editId, modelEditId);
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

test("snapshot comparison treats inserted bullets as one added block", () => {
  const source = normalizeTailorResumeLatex(String.raw`
\resumeSection{WORK EXPERIENCE}
\entryheading{Example Co}{Engineer}{2024}
\begin{resumebullets}
  \resumeitem{First bullet}
  \resumeitem{Second bullet}
\end{resumebullets}
`);
  const end = normalizeTailorResumeLatex(
    source.annotatedLatex.replace(
      "  % JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2",
      "  % JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-added-a1b2c3\n  \\resumeitem{Inserted bullet}\n  % JOBHELPER_SEGMENT_ID: work-experience.entry-1.bullet-2",
    ),
  );
  const comparisonEdits = buildTailoredResumeSnapshotComparisonEdits({
    endAnnotatedLatexCode: end.annotatedLatex,
    startAnnotatedLatexCode: source.annotatedLatex,
  });

  assert.equal(comparisonEdits.length, 1);
  assert.equal(
    comparisonEdits[0]?.segmentId,
    "work-experience.entry-1.bullet-added-a1b2c3",
  );
  assert.equal(comparisonEdits[0]?.beforeLatexCode, "");
  assert.equal(
    comparisonEdits[0]?.afterLatexCode.trim(),
    "\\resumeitem{Inserted bullet}",
  );
});

test("applying a tailored edit to source latex extracts the selected block from a full document replacement", () => {
  const normalized = normalizeTailorResumeLatex(tailorResumeLatexExample);
  const sourceBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Created full-stack dashboard for project management",
  );
  const unrelatedBlock = findBlockBySnippet(
    normalized.annotatedLatex,
    "Led \\textbf{SEO} improvements",
  );
  const fullTailoredAnnotatedLatex = replaceBlockInAnnotatedLatex({
    annotatedLatexCode: replaceBlockInAnnotatedLatex({
      annotatedLatexCode: normalized.annotatedLatex,
      replacementLatexCode:
        "\\resumeitem{Added explicit open-source collaboration bullet}",
      segmentId: sourceBlock.id,
    }),
    replacementLatexCode:
      "\\resumeitem{This unrelated full-document change must not land}",
    segmentId: unrelatedBlock.id,
  });
  const result = applyTailoredResumeEditToSourceLatex({
    beforeLatexCode: sourceBlock.latexCode,
    replacementLatexCode: stripTailorResumeSegmentIds(fullTailoredAnnotatedLatex),
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
  assert.doesNotMatch(
    result.latexCode,
    /This unrelated full-document change must not land/,
  );
  assert.match(result.latexCode, /Led \\textbf\{SEO\} improvements/);
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
