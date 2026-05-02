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
  assert.match(prompt, /resume-searchable skills/i);
  assert.match(prompt, /company-specific internal products/i);
  assert.match(prompt, /employer-branded terms/i);
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
  assert.match(prompt, /Quoted bullets under technology-specific USER\.md headings/i);
  assert.match(prompt, /strong grounded candidates for experience-bullet edits/i);
  assert.match(prompt, /only by adding it to the skills section/i);
  assert.match(prompt, /experience-bullet replacement or swap/i);
  assert.match(prompt, /plan it as a swap/i);
  assert.match(prompt, /weakest or least job-relevant existing bullet/i);
  assert.match(prompt, /desiredPlainText to an empty string/i);
  assert.match(prompt, /deleting one whole bullet or line/i);
  assert.match(prompt, /primary goal is to make sure the final planned resume text includes every remaining high-priority keyword/i);
  assert.match(prompt, /check_planned_resume_keyword_coverage/i);
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

test("buildTailorResumeInterviewSystemPrompt keeps user-facing interview text concise and mirrored for rendering", () => {
  const prompt = buildTailorResumeInterviewSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.match(prompt, /normal assistant text/i);
  assert.match(prompt, /rendered visibly in the chat UI/i);
  assert.match(prompt, /not hidden metadata/i);
  assert.match(prompt, /never repeat definitions, examples, or technologyContexts content/i);
  assert.match(prompt, /completionMessage/i);
  assert.match(prompt, /tool call is the control-plane output/i);
  assert.match(prompt, /ask all useful missing-technology questions together/i);
  assert.match(prompt, /adapt it to the user's new constraint or correction/i);
  assert.match(prompt, /do not repeat the same examples with light rewording/i);
  assert.match(prompt, /avoid repeating it verbatim on later turns/i);
  assert.match(prompt, /keep the overall interview short/i);
  assert.match(prompt, /one batched ask turn is enough/i);
  assert.match(prompt, /Do not ask one technology per turn/i);
  assert.match(prompt, /possible answer shapes, not claims about what the user did/i);
  assert.match(prompt, /initiate_tailor_resume_probing_questions/i);
  assert.match(prompt, /finish_tailor_resume_interview/i);
  assert.match(prompt, /gives the user the final Done button/i);
  assert.match(prompt, /sample bullet, example, draft, clarification, or review/i);
  assert.match(prompt, /Go beside backend\/API work/i);
  assert.match(prompt, /JavaScript framework/i);
  assert.match(prompt, /resume lists C\+\+/i);
  assert.match(prompt, /deterministic keyword presence/i);
  assert.match(prompt, /cannot cleanly assume the user's experience/i);
  assert.match(prompt, /internet terminology/i);
  assert.match(prompt, /Not mentioned in your resume or USER\.md/i);
  assert.match(prompt, /one compact inline list/i);
  assert.match(prompt, /technologyContexts/i);
  assert.match(prompt, /follow-up turns/i);
  assert.match(prompt, /compact collapsible cards/i);
  assert.match(prompt, /do not repeat any technology definition or example bullet/i);
  assert.match(prompt, /definitions or example bullets in assistantMessage/i);
  assert.match(prompt, /one-sentence explanation/i);
  assert.match(prompt, /Return exactly two examples by default/i);
  assert.match(prompt, /requested count for that technology, up to six examples/i);
  assert.match(prompt, /providing technology-specific example bullets/i);
  assert.match(prompt, /answer with technologyContexts cards/i);
  assert.match(prompt, /FAANG-level resume bullet suggestions/i);
  assert.match(prompt, /positive result in the same sentence/i);
  assert.match(prompt, /Migrated time-series data from MongoDB to Cassandra/i);
  assert.match(prompt, /reduce storage costs 40% and improve query tail latency by 2x/i);
  assert.match(prompt, /Wrote Spark streaming pipeline/i);
  assert.match(prompt, /10k msg\/sec with exactly-once semantics/i);
  assert.match(prompt, /do not need to be entirely new bullets/i);
  assert.match(prompt, /slight modification of that bullet/i);
  assert.match(prompt, /not the technology name/i);
  assert.match(prompt, /never `-- Cassandra`/i);
  assert.match(prompt, /do not label the explanation as "Definition"/i);
  assert.match(prompt, /or "One-sentence"/i);
  assert.match(prompt, /do not label the bullets as "Example A"/i);
  assert.match(prompt, /unless the user explicitly asks for more/i);
  assert.match(prompt, /Apache Spark helps you process large amounts of data/i);
  assert.match(prompt, /Step 2 exists only to gather reusable context and update USER\.md/i);
  assert.match(prompt, /must not decide how to tailor the resume/i);
  assert.match(prompt, /Never ask whether to add, replace, append, insert, or swap a bullet/i);
  assert.match(prompt, /Step 3 planning chooses skills versus existing bullets versus appended bullets/i);
  assert.match(prompt, /quoted user-confirmed experience-evidence bullets/i);
  assert.match(prompt, /technology-specific headings/i);
  assert.match(prompt, /Quoted bullets are user-confirmed experience evidence/i);
  assert.match(prompt, /not instructions to add, replace, append, insert, or swap/i);
  assert.match(prompt, /Step 3 planning decides whether that memory should become a skills entry/i);
  assert.match(prompt, /After each user answer, compare the full conversation against the current USER\.md/i);
  assert.match(prompt, /include a USER\.md patch on that turn even if you still need to ask one more question/i);
  assert.match(prompt, /every durable fact from the entire chat/i);
  assert.match(prompt, /Do not write only the latest user message/i);
  assert.match(prompt, /Do not turn uncertain or adjacent experience into a quoted production-style claim/i);
  assert.match(prompt, /Unquoted bullets are factual notes or constraints/i);
  assert.match(prompt, /No direct production Cassandra experience/i);
  assert.match(prompt, /initiate_tailor_resume_probing_questions may edit USER\.md only after the user has answered/i);
  assert.match(prompt, /Step 2 owns high-priority keyword accounting/i);
  assert.match(prompt, /keywordDecisions/i);
  assert.match(prompt, /action "remove"/i);
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
  assert.match(prompt, /Quoted bullets under technology headings are user-confirmed experience evidence/i);
  assert.match(prompt, /actual experience-bullet replacement/i);
  assert.match(prompt, /rather than downgrading it to a skills-only keyword/i);
  assert.match(prompt, /not placement instructions/i);
  assert.match(prompt, /Unquoted bullets are factual notes/i);
  assert.match(prompt, /use an empty latexCode when removing that single planned bullet or line/i);
  assert.match(prompt, /Do not leave an empty \\resumeitem\{\}/i);
  assert.match(prompt, /replaces a lower-signal bullet with user-confirmed technology experience/i);
  assert.match(prompt, /Do not move the technology only to skills/i);
  assert.match(prompt, /secondary goal is to avoid keyword regressions from that accepted plan/i);
  assert.match(prompt, /check_implemented_resume_keyword_coverage/i);
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
