import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTailorResumeSupportChatFinalSummaryInstructions,
  buildTailorResumeSupportChatInstructions,
} from "../lib/system-prompt-settings.ts";

const supportChatPromptInput = {
  maxSupportChatBulkResumeBulletCount: 10,
};

function buildSupportChatTestInstructions() {
  return buildTailorResumeSupportChatInstructions(supportChatPromptInput);
}

test("support chat exposes simple rendered line-count and malformed tools before saving bullet support", () => {
  const source = readFileSync(
    new URL("../lib/tailor-resume-support-chat.ts", import.meta.url),
    "utf8",
  );
  const measureToolIndex = source.indexOf("measure_resume_bullet_line_count");
  const malformedToolIndex = source.indexOf("check_resume_bullet_malformed");
  const malformedListToolIndex = source.indexOf(
    "list_malformed_resume_bullet_support",
  );
  const createToolIndex = source.indexOf("create_resume_bullet_support");

  assert.notEqual(measureToolIndex, -1);
  assert.notEqual(malformedToolIndex, -1);
  assert.notEqual(malformedListToolIndex, -1);
  assert.notEqual(createToolIndex, -1);
  assert.ok(measureToolIndex < createToolIndex);
  assert.ok(malformedToolIndex < createToolIndex);
  assert.ok(malformedListToolIndex < createToolIndex);
  assert.match(source, /measureTailorResumeSpareBulletLineCount/);
  assert.doesNotMatch(source, /buildTailorResumeRenderedBulletHealthCheck/);
  assert.match(source, /formatTailorResumeMalformedBulletCheckMessage/);
  assert.match(source, /buildResumeBulletMeasurementToolParameters/);
  assert.match(source, /required: \["quote", "resumeExperienceId"\]/);
  assert.doesNotMatch(source, /required: \["quote", "replacesQuote", "resumeExperienceId", "reason"\]/);
  assert.match(source, /exact rendered PDF line count/i);
  assert.match(source, /less than half filled/i);
});

test("support chat instructions tell the model to measure drafted bullets before saving", () => {
  const instructions = buildSupportChatTestInstructions();

  assert.match(instructions, /measure_resume_bullet_line_count/);
  assert.match(instructions, /check_resume_bullet_malformed/);
  assert.match(instructions, /list_malformed_resume_bullet_support/);
  assert.match(instructions, /does not scan the base resume/i);
  assert.match(instructions, /takes only `quote` and `resumeExperienceId`/);
  assert.match(instructions, /do not include a reason or current\/source bullet text/);
  assert.match(instructions, /before saving/i);
  assert.match(instructions, /malformed: true/i);
});

test("support chat instructions explain every tool available to the model", () => {
  const instructions = buildSupportChatTestInstructions();

  assert.match(instructions, /Tool guide:/);
  assert.match(instructions, /list_resume_skill_support/);
  assert.match(instructions, /list_resume_experiences/);
  assert.match(instructions, /get_current_latex_resume/);
  assert.match(instructions, /create_skills_section_skill/);
  assert.match(instructions, /measure_resume_bullet_line_count/);
  assert.match(instructions, /check_resume_bullet_malformed/);
  assert.match(instructions, /list_malformed_resume_bullet_support/);
  assert.match(instructions, /create_resume_bullet_support` saves one/);
  assert.match(instructions, /update_resume_bullet_support/);
  assert.match(instructions, /delete_resume_bullet_support/);
  assert.match(instructions, /create_resume_bullet_support_batch/);
  assert.match(instructions, /Do not spend separate measure\/check calls before the batch tool/);
});

test("support chat instructions avoid false success on ambiguous similar bullets", () => {
  const instructions = buildSupportChatTestInstructions();

  assert.match(instructions, /not merely by a shared skill like Go/);
  assert.match(instructions, /multiple saved bullets plausibly match/);
  assert.match(instructions, /ask a short clarification/);
  assert.match(instructions, /name the exact id and quote you checked/);
});

test("support chat exposes ids and id-based saved bullet mutation tools", () => {
  const source = readFileSync(
    new URL("../lib/tailor-resume-support-chat.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /id=\$\{spareBullet\.id\}/);
  assert.match(source, /update_resume_bullet_support/);
  assert.match(source, /delete_resume_bullet_support/);
  assert.match(source, /deleteTailorResumeSpareBullet/);
  assert.match(source, /required: \[\s*"id",\s*"quote",\s*"replacesQuote",\s*"resumeExperienceId",\s*"skillNames",\s*"reason",\s*\]/);
  assert.match(source, /required: \["id", "reason"\]/);
});

test("support chat list tool promotes fresh skill data for extension refresh", () => {
  const source = readFileSync(
    new URL("../lib/tailor-resume-support-chat.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /if \(input\.toolCall\.name === listSkillSupportToolName\)[\s\S]*output: \{[\s\S]*skillData,[\s\S]*\},[\s\S]*skillData,/,
  );
});

test("support chat route deletes aborted user turns instead of leaving orphan messages", () => {
  const source = readFileSync(
    new URL("../app/api/tailor-resume/support-chat/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /deleteTailorResumeChatMessage/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /id: userTurn\.userMessage\.id/);
});

test("support chat exposes a bounded bulk bullet support workflow", () => {
  const source = readFileSync(
    new URL("../lib/tailor-resume-support-chat.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /maxSupportChatToolRounds = 20/);
  assert.match(source, /maxSupportChatBulkResumeBulletCount = 10/);
  assert.match(source, /create_resume_bullet_support_batch/);
  assert.match(source, /maxItems: maxSupportChatBulkResumeBulletCount/);

  const instructions = buildSupportChatTestInstructions();
  const finalSummaryInstructions =
    buildTailorResumeSupportChatFinalSummaryInstructions(supportChatPromptInput);

  assert.match(instructions, /three or more lines/);
  assert.match(instructions, /results/);
  assert.match(finalSummaryInstructions, /Do not call any tools/);
});
