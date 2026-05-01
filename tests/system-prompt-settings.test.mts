import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobApplicationExtractionSystemPrompt,
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

test("job application extraction prompt encourages short team names in job titles", () => {
  const prompt = buildJobApplicationExtractionSystemPrompt(
    createDefaultSystemPromptSettings(),
  );

  assert.match(prompt, /Role \(Team\)/);
  assert.match(prompt, /1-2 word parenthetical/i);
  assert.match(prompt, /Software Engineer \(Quantum\)/);
  assert.match(prompt, /plain role title with no parentheses/i);
});

test("mergeSystemPromptSettings keeps extraction prompt team-title guidance for saved prompts", () => {
  const mergedSettings = mergeSystemPromptSettings({
    jobApplicationExtraction: "Custom extraction instructions.",
  });

  assert.match(
    mergedSettings.jobApplicationExtraction,
    /Custom extraction instructions\./,
  );
  assert.match(
    mergedSettings.jobApplicationExtraction,
    /Software Engineer \(Quantum\)/,
  );
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
  assert.match(prompt, /emphasizedTechnologies/);
  assert.match(prompt, /priority must be exactly high or low/i);
  assert.match(prompt, /required\/basic\/minimum/i);
  assert.match(
    prompt,
    /Hard rule: if a slash, comma, parenthetical, or grouped phrase separates/i,
  );
  assert.match(
    prompt,
    /must return separate emphasizedTechnologies items/i,
  );
  assert.match(
    prompt,
    /TypeScript and JavaScript instead of TypeScript\/JavaScript/i,
  );
  assert.match(
    prompt,
    /React and Next\.js instead of React \/ Next\.js/i,
  );
  assert.match(prompt, /Visual Studio instead of Microsoft Visual Studio/i);
  assert.match(prompt, /deterministic string matching/i);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumePlanningSystemPrompt does not ask for job identifiers", () => {
  const prompt = buildTailorResumePlanningSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.doesNotMatch(prompt, /jobIdentifier/i);
});

test("buildTailorResumeInterviewSystemPrompt injects retry feedback", () => {
  const prompt = buildTailorResumeInterviewSystemPrompt(
    createDefaultSystemPromptSettings(),
    {
      feedback: "The previous interview response asked too many low-value follow-up questions.",
    },
  );

  assert.match(prompt, /Previous interview feedback:/);
  assert.match(prompt, /asked too many low-value follow-up questions/);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumeInterviewSystemPrompt keeps user-facing interview text outside tool arguments", () => {
  const prompt = buildTailorResumeInterviewSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.match(prompt, /normal assistant text/i);
  assert.match(prompt, /tool call is the control-plane output/i);
  assert.match(prompt, /keep the follow-up question concise/i);
  assert.match(prompt, /adapt it to the user's new constraint or correction/i);
  assert.match(prompt, /do not repeat the same examples with light rewording/i);
  assert.match(prompt, /avoid repeating it verbatim on later turns/i);
  assert.match(prompt, /keep the overall interview short/i);
  assert.match(prompt, /usually ask only one follow-up question/i);
  assert.match(prompt, /rarely ask more than 2-3 total/i);
  assert.match(prompt, /possible answer shapes, not claims about what the user did/i);
  assert.match(prompt, /ask_tailor_resume_follow_up/i);
  assert.match(prompt, /finish_tailor_resume_interview/i);
  assert.match(prompt, /Do not finish just because the user sent one answer/i);
  assert.match(prompt, /sample bullet, example, draft, clarification, or review/i);
  assert.match(prompt, /close neighbors of resume-supported experience/i);
  assert.match(prompt, /JavaScript framework/i);
  assert.match(prompt, /resume lists C\+\+/i);
  assert.match(prompt, /high-priority terms as the first Step 2 candidates/i);
  assert.match(prompt, /Spring Boot API layer around the LLM pipeline/i);
  assert.match(prompt, /prompt orchestration, retrieval, and eval logging/i);
  assert.match(prompt, /Which model family, serving stack, and measurable outcome best match your work/i);
  assert.equal(
    prompt.includes("make the question text do four jobs"),
    false,
  );
  assert.equal(prompt.includes("totalQuestionBudget"), false);
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
  assert.match(prompt, /high-priority exact technology keywords/i);
  assert.match(prompt, /Use low-priority terms only when they fit naturally/i);
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
      estimatedLineReduction: 3,
      targetPageCount: 1,
    },
  );

  assert.match(prompt, /keep this resume to a single page/i);
  assert.match(prompt, /Single page is a hard requirement\./i);
  assert.match(prompt, /current tailored preview is 2 pages/i);
  assert.match(prompt, /about 3 rendered lines must be removed/i);
  assert.match(prompt, /Use the measurement tool as a scratchpad before your final submission/i);
  assert.match(prompt, /exact page-count verification tool/i);
  assert.match(prompt, /actual rendered page count under the same final acceptance logic/i);
  assert.match(prompt, /Only touch blocks where your proposed replacement is likely to remove/i);
  assert.match(prompt, /same-line-count edits/i);
  assert.match(prompt, /measurement tool will reject/i);
  assert.match(prompt, /already-one-line blocks as last-resort cuts/i);
  assert.match(prompt, /do not call the job done until the exact page-count verification is at or below the target/i);
  assert.match(prompt, /Lead with what changed in the context of the job description/i);
  assert.match(prompt, /Mention the need to shorten only as a passing sentence fragment/i);
  assert.match(prompt, /fully replaces the old reason shown to the user/i);
  assert.equal(prompt.includes("{{TARGET_PAGE_COUNT_REQUIREMENT}}"), false);
  assert.equal(prompt.includes("{{ESTIMATED_LINE_REDUCTION}}"), false);
});
