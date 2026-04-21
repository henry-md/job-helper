import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailorResumeRefinementSystemPrompt,
  createDefaultSystemPromptSettings,
} from "../lib/system-prompt-settings.ts";
import {
  parseTailoredResumeRefinementResponse,
  validateTailoredResumeRefinementChanges,
} from "../lib/tailor-resume-refinement.ts";
import type { TailoredResumeBlockEditRecord } from "../lib/tailor-resume-types.ts";

const existingEdits: TailoredResumeBlockEditRecord[] = [
  {
    afterLatexCode: "\\resumeitem{Tailored bullet one}",
    beforeLatexCode: "\\resumeitem{Original bullet one}",
    command: "resumeitem",
    customLatexCode: null,
    editId: "experience.entry-1.bullet-1:model",
    reason: "Model reason one",
    state: "applied",
    segmentId: "experience.entry-1.bullet-1",
  },
  {
    afterLatexCode: "\\resumeitem{Tailored bullet two}",
    beforeLatexCode: "\\resumeitem{Original bullet two}",
    command: "resumeitem",
    customLatexCode: null,
    editId: "experience.entry-1.bullet-2:model",
    reason: "Model reason two",
    state: "applied",
    segmentId: "experience.entry-1.bullet-2",
  },
];

test("parseTailoredResumeRefinementResponse keeps summary and changes", () => {
  const parsed = parseTailoredResumeRefinementResponse({
    changes: [
      {
        latexCode: "\\resumeitem{Sharper bullet one}",
        reason: "Tightens the wording.",
        segmentId: "experience.entry-1.bullet-1",
      },
      {
        latexCode: "\\resumeitem{Sharper bullet two}",
        reason: "Keeps the fit but shortens the block.",
        segmentId: "experience.entry-1.bullet-2",
      },
    ],
    summary: "Tightened both bullets so the resume reads cleaner.",
  });

  assert.equal(
    parsed.summary,
    "Tightened both bullets so the resume reads cleaner.",
  );
  assert.equal(parsed.changes.length, 2);
  assert.equal(parsed.changes[0]?.segmentId, "experience.entry-1.bullet-1");
});

test("validateTailoredResumeRefinementChanges requires every existing segment", () => {
  assert.throws(
    () =>
      validateTailoredResumeRefinementChanges({
        changes: [
          {
            latexCode: "\\resumeitem{Sharper bullet one}",
            reason: "Tightens the wording.",
            segmentId: "experience.entry-1.bullet-1",
          },
        ],
        existingEdits,
      }),
    /exactly one refinement for every edited block/i,
  );
});

test("validateTailoredResumeRefinementChanges rejects unknown segments", () => {
  assert.throws(
    () =>
      validateTailoredResumeRefinementChanges({
        changes: [
          {
            latexCode: "\\resumeitem{Sharper bullet one}",
            reason: "Tightens the wording.",
            segmentId: "experience.entry-1.bullet-1",
          },
          {
            latexCode: "\\resumeitem{Unknown bullet}",
            reason: "Should not be accepted.",
            segmentId: "experience.entry-9.bullet-9",
          },
        ],
        existingEdits,
      }),
    /unknown segment/i,
  );
});

test("tailor resume refinement system prompt explains the preview highlight key", () => {
  const prompt = buildTailorResumeRefinementSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.match(prompt, /Amber\/yellow highlight = changed or rewritten text/i);
  assert.match(prompt, /Green highlight = newly added text/i);
  assert.match(prompt, /Blue highlight = the currently focused block/i);
  assert.match(prompt, /fully replaces the old saved reason/i);
  assert.match(prompt, /do not make the reason just say that the block was shortened/i);
  assert.match(prompt, /use the rendered PDF screenshots to judge whether an edit actually removes a full rendered line/i);
  assert.match(prompt, /prefer one minimal edit to one original block/i);
});
