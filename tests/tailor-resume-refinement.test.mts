import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTailorResumeRefinementSystemPrompt,
  createDefaultSystemPromptSettings,
} from "../lib/system-prompt-settings.ts";
import {
  buildTailoredResumeReviewChatTranscript,
  parseTailoredResumeRefinementResponse,
  validateTailoredResumeRefinementChanges,
} from "../lib/tailor-resume-refinement.ts";
import { buildTailoredResumeReviewChatMessagesFromVersions } from "../lib/tailored-resume-review-chat-history.ts";
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
const editableSegmentIds = [
  ...existingEdits.map((edit) => edit.segmentId),
  "experience.entry-2.bullet-1",
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
    insertions: [],
    summary: "Tightened both bullets so the resume reads cleaner.",
  });

  assert.equal(
    parsed.summary,
    "Tightened both bullets so the resume reads cleaner.",
  );
  assert.equal(parsed.changes.length, 2);
  assert.equal(parsed.insertions.length, 0);
  assert.equal(parsed.changes[0]?.segmentId, "experience.entry-1.bullet-1");
});

test("validateTailoredResumeRefinementChanges allows omitted unchanged segments", () => {
  assert.doesNotThrow(() =>
    validateTailoredResumeRefinementChanges({
      changes: [
        {
          latexCode: "\\resumeitem{Sharper bullet one}",
          reason: "Tightens the wording.",
          segmentId: "experience.entry-1.bullet-1",
        },
      ],
      editableSegmentIds,
    }),
  );
});

test("validateTailoredResumeRefinementChanges allows editable segments that were not initially edited", () => {
  assert.doesNotThrow(() =>
    validateTailoredResumeRefinementChanges({
      changes: [
        {
          latexCode: "\\resumeitem{Newly refined original bullet}",
          reason: "Applies the user's requested follow-up to a previously unchanged block.",
          segmentId: "experience.entry-2.bullet-1",
        },
      ],
      editableSegmentIds,
    }),
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
        editableSegmentIds,
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
  assert.match(prompt, /listed editable segmentIds/i);
  assert.match(prompt, /Do not write JOBHELPER_SEGMENT_ID comments/i);
  assert.match(prompt, /fully replaces the old saved reason/i);
  assert.match(prompt, /do not make the reason just say that the block was shortened/i);
  assert.match(prompt, /use the rendered PDF screenshots to judge whether an edit actually removes a full rendered line/i);
  assert.match(prompt, /prefer one minimal edit to one original block/i);
  assert.match(prompt, /answer the question instead of explaining that no edit was made/i);
  assert.match(prompt, /Use the keyword-coverage tool/i);
  assert.doesNotMatch(prompt, /saved scraped-keyword coverage report/i);
});

test("tailored resume review chat exposes the refinement health-check tool", () => {
  const source = readFileSync(
    new URL("../lib/tailor-resume-refinement.ts", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../app/api/tailor-resume/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /check_refined_resume_health/);
  assert.match(source, /rendered page-count and malformed-bullet result/i);
  assert.match(routeSource, /toolCalls: refinementResult\.toolCalls/);
});

test("tailored resume review chat exposes keyword coverage as a tool", () => {
  const source = readFileSync(
    new URL("../lib/tailor-resume-refinement.ts", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../app/api/tailor-resume/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /list_refined_resume_keyword_coverage/);
  assert.match(source, /listRefinedResumeKeywordCoverage/);
  assert.match(source, /buildTailoredResumeKeywordCoverage/);
  assert.match(source, /includedInTailored/);
  assert.match(source, /missingFromTailored/);
  assert.match(source, /newlyAddedVsOriginal/);
  assert.match(routeSource, /keywordCoverage: tailoredResume\.keywordCoverage/);
});

test("tailored resume review chat falls back to refinement version history", () => {
  const messages = buildTailoredResumeReviewChatMessagesFromVersions([
    {
      annotatedLatexCode: "initial",
      assistantMessage: null,
      createdAt: "2026-06-09T20:00:00.000Z",
      edits: existingEdits,
      error: null,
      id: "initial-version",
      latexCode: "initial",
      pdfUpdatedAt: null,
      source: "initial",
      sourceAnnotatedLatexCode: null,
      status: "ready",
      userPrompt: null,
    },
    {
      annotatedLatexCode: "refined",
      assistantMessage: "Changed the first bullet.",
      createdAt: "2026-06-09T20:01:00.000Z",
      edits: existingEdits,
      error: null,
      id: "refinement-version",
      latexCode: "refined",
      pdfUpdatedAt: "2026-06-09T20:01:00.000Z",
      source: "refinement",
      sourceAnnotatedLatexCode: "source",
      status: "ready",
      userPrompt: "Change the first bullet.",
    },
  ]);

  assert.deepEqual(
    messages.map((message) => [message.role, message.content]),
    [
      ["user", "Change the first bullet."],
      ["assistant", "Changed the first bullet."],
    ],
  );
});

test("tailored resume refinement transcript keeps prior user and assistant turns", () => {
  const transcript = buildTailoredResumeReviewChatTranscript([
    {
      content: "Turn the first bullet to test 1.",
      role: "user",
    },
    {
      content: "Updated the first bullet.",
      role: "assistant",
    },
  ]);

  assert.match(transcript, /User: Turn the first bullet to test 1\./);
  assert.match(transcript, /Assistant: Updated the first bullet\./);
});
