import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTailorResumePageCountCompactionPrompt,
  buildResumeLatexSystemPrompt,
  buildTailorResumeInterviewSystemPrompt,
  buildTailorResumeImplementationSystemPrompt,
  buildTailorResumePlanningSystemPrompt,
  buildTailorResumeRefinementSystemPrompt,
  createDefaultSystemPromptSettings,
  mergeSystemPromptSettings,
} from "../lib/system-prompt-settings.ts";

test("mergeSystemPromptSettings preserves defaults for missing keys", () => {
  const mergedSettings = mergeSystemPromptSettings({
    tailorResumePlanning: "Custom planning prompt",
  });

  assert.equal(
    mergedSettings.tailorResumePlanning,
    "Custom planning prompt",
  );
  assert.equal(typeof mergedSettings.resumeLatexExtraction, "string");
  assert.equal(typeof mergedSettings.tailorResumeInterview, "string");
  assert.equal(typeof mergedSettings.tailorResumeRefinement, "string");
  assert.equal(typeof mergedSettings.tailorResumePageCountCompaction, "string");
});

test("buildResumeLatexSystemPrompt injects retry tokens", () => {
  const prompt = buildResumeLatexSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      attempt: 2,
      maxAttempts: 3,
    },
  );

  assert.match(prompt, /Retry attempt 2 of 3:/);
  assert.match(prompt, /You have at most 3 validation attempts\./);
  assert.equal(prompt.includes("{{RETRY_INSTRUCTIONS}}"), false);
  assert.equal(prompt.includes("{{MAX_ATTEMPTS}}"), false);
});

test("buildTailorResumePlanningSystemPrompt injects retry feedback", () => {
  const prompt = buildTailorResumePlanningSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      feedback: "Missing thesis object",
    },
  );

  assert.match(prompt, /Previous attempt feedback:/);
  assert.match(prompt, /Missing thesis object/);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumePlanningSystemPrompt asks for job numbers as identifiers", () => {
  const prompt = buildTailorResumePlanningSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.match(prompt, /jobIdentifier should prefer a visible requisition, job, posting, or reference number\/id/i);
  assert.match(prompt, /without labels like "Job ID:"/i);
});

test("buildTailorResumeInterviewSystemPrompt injects retry feedback", () => {
  const prompt = buildTailorResumeInterviewSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      feedback: "The previous interview response changed the question budget.",
    },
  );

  assert.match(prompt, /Previous interview feedback:/);
  assert.match(prompt, /changed the question budget/);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumeInterviewSystemPrompt requires concise question framing", () => {
  const prompt = buildTailorResumeInterviewSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.match(prompt, /keep the user-facing question concise/i);
  assert.match(prompt, /say what in the job description suggests this skill or detail is important/i);
  assert.match(prompt, /could not find that same skill or detail in the resume/i);
  assert.match(prompt, /give 1-2 brief examples of strong answers/i);
  assert.match(prompt, /tailored to that job-description signal/i);
  assert.match(prompt, /specific tools, ownership, practices, metrics, scope, domain context, or outcomes/i);
  assert.match(prompt, /possible answer shapes, not claims about what the user did/i);
  assert.match(prompt, /ask_tailor_resume_follow_up/i);
  assert.match(prompt, /finish_tailor_resume_interview/i);
  assert.match(prompt, /Do not finish just because the user sent one answer/i);
  assert.match(prompt, /sample bullet, example, draft, clarification, or review/i);
  assert.match(prompt, /close neighbors of resume-supported experience/i);
  assert.match(prompt, /JavaScript framework/i);
  assert.match(prompt, /resume lists C\+\+/i);
  assert.match(prompt, /During the NewForm refactor, which observability\/diagnosability tools/i);
  assert.match(prompt, /job description mentions structured logging and OpenTelemetry/i);
  assert.match(prompt, /I added OpenTelemetry tracing to tRPC endpoints/i);
  assert.match(prompt, /I built alerts\/dashboards that cut debugging time by 30%/i);
});

test("buildTailorResumeInterviewSystemPrompt injects debug-force instructions", () => {
  const prompt = buildTailorResumeInterviewSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      debugForceConversation: true,
    },
  );

  assert.match(
    prompt,
    /DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE is enabled/i,
  );
  assert.match(prompt, /must ask at least one follow-up question/i);
  assert.match(prompt, /would_ask_without_debug/);
  assert.match(prompt, /forced_only/);
  assert.equal(prompt.includes("{{DEBUG_FORCE_BLOCK}}"), false);
});

test("buildTailorResumeImplementationSystemPrompt injects retry feedback", () => {
  const prompt = buildTailorResumeImplementationSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      feedback: "Unknown segment returned",
    },
  );

  assert.match(prompt, /Previous implementation feedback:/);
  assert.match(prompt, /Unknown segment returned/);
  assert.match(prompt, /Do not change dates of experience/i);
  assert.match(prompt, /punctuation, separators, capitalization, or link text/i);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumeRefinementSystemPrompt injects retry feedback", () => {
  const prompt = buildTailorResumeRefinementSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      feedback: "The previous refinement did not compile.",
    },
  );

  assert.match(prompt, /Previous refinement feedback:/);
  assert.match(prompt, /did not compile/);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumePageCountCompactionPrompt injects page count tokens", () => {
  const prompt = buildTailorResumePageCountCompactionPrompt(
    createDefaultSystemPromptSettings(),
    {
      currentPageCount: 2,
      targetPageCount: 1,
    },
  );

  assert.match(prompt, /keep this resume to a single page/i);
  assert.match(prompt, /Single page is a hard requirement\./i);
  assert.match(prompt, /current tailored preview is 2 pages/i);
  assert.match(prompt, /use the rendered PDF with highlights/i);
  assert.match(prompt, /if only one line needs to be reclaimed overall/i);
  assert.match(prompt, /fully replaces the old reason shown to the user/i);
  assert.equal(prompt.includes("{{TARGET_PAGE_COUNT_REQUIREMENT}}"), false);
});
