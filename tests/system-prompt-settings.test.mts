import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobApplicationExtractionSystemPrompt,
  buildTailorResumePageCountCompactionInstructions,
  buildTailorResumePageCountCompactionPrompt,
  buildResumeLatexSystemPrompt,
  buildTailorResumeInterviewSystemPrompt,
  buildTailorResumeImplementationSystemPrompt,
  buildTailorResumePlanningSystemPrompt,
  buildTailorResumeTechnologyExtractionInstructions,
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
  assert.equal(typeof mergedSettings.tailorResumeStep2ExperienceChat, "string");
  assert.equal(typeof mergedSettings.tailorResumeRefinement, "string");
  assert.equal(typeof mergedSettings.tailorResumePageCountCompaction, "string");
});

test("default Step 2 experience chat prompt is editable without dynamic technology names", () => {
  const settings = createDefaultSystemPromptSettings();

  assert.match(
    settings.tailorResumeStep2ExperienceChat,
    /Help me craft resume experiences/i,
  );
  assert.match(settings.tailorResumeStep2ExperienceChat, /letter order A\. B\. C\./i);
  assert.doesNotMatch(settings.tailorResumeStep2ExperienceChat, /Technologies:/i);
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
  assert.match(prompt, /Skills or Technical Skills section/i);
  assert.match(prompt, /never return Production Infrastructure or Production clusters/i);
  assert.match(prompt, /return Kubernetes for Kubernetes-based PaaS/i);
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
  assert.match(prompt, /commit previews, blueprints, storage systems/i);
  assert.match(prompt, /Chromium/i);
  assert.match(prompt, /USER\.md as contextual memory adjacent to the resume/i);
  assert.match(prompt, /not as a permission checkpoint/i);
  assert.match(prompt, /examples and context rather than permission/i);
  assert.match(prompt, /include the exact hard-skill keyword in the skills section/i);
  assert.match(prompt, /concrete hard skill such as a technology/i);
  assert.match(prompt, /bullet keyword coverage alone is not enough for actual skills/i);
  assert.match(prompt, /experience-bullet replacement or swap/i);
  assert.match(prompt, /plan it as a swap/i);
  assert.match(prompt, /weakest or least job-relevant existing bullet/i);
  assert.match(prompt, /editIntent that says to remove/i);
  assert.match(prompt, /entire bullet\/line segment/i);
  assert.match(prompt, /Step 3 decides where resume-adjacent and memory-adjacent keywords should go/i);
  assert.match(prompt, /Step 4 writes the exact LaTeX wording/i);
  assert.match(prompt, /editIntent must be a short instruction/i);
  assert.match(prompt, /targetKeywords must list the exact emphasizedTechnology names/i);
  assert.match(prompt, /Do not write final resume prose here/i);
  assert.match(prompt, /ideal job-specific resume/i);
  assert.match(prompt, /low-priority keyword list/i);
  assert.match(prompt, /Do not abandon a keyword after one awkward attempt/i);
  assert.match(prompt, /When editing Skills or Technical Skills, add actual concrete skills generously/i);
  assert.match(prompt, /It is a GOOD idea to pack job-relevant concrete hard-skill keywords into Skills for ATS matching/i);
  assert.match(prompt, /even when those exact terms are not in the bullets/i);
  assert.match(prompt, /weave them into the middle of the closest existing comma-separated skill list or category/i);
  assert.match(prompt, /Do not append all newly added keywords at the end/i);
  assert.match(prompt, /adjacent to the resume, USER\.md context/i);
  assert.match(prompt, /Be extremely optimistic about what the user likely has experience with/i);
  assert.match(prompt, /even when the exact term is not explicitly mentioned in experience/i);
  assert.match(prompt, /Do not make the user choose between bullet coverage and skills-list coverage/i);
  assert.match(prompt, /Skills keyword set must be a strict superset of concrete hard-skill keywords bolded in bullets/i);
  assert.match(prompt, /plan a Skills change that includes that exact keyword as well/i);
  assert.match(prompt, /Skills-only ATS coverage entry for a concrete hard skill/i);
  assert.match(prompt, /If a concrete hard skill is useful ATS coverage but cannot responsibly fit in a bullet/i);
  assert.match(prompt, /if the plan asks Step 4 to bold a concrete technology/i);
  assert.match(prompt, /the plan must also add or preserve that exact keyword in Skills/i);
  assert.match(prompt, /Do not add peppering\/capability phrases such as broad API/i);
  assert.match(prompt, /infrastructure, fundamentals, or process wording/i);
  assert.match(prompt, /If a concrete hard skill is adjacent to the resume or USER\.md context/i);
  assert.match(prompt, /Skills-only keyword packing is often the right placement for ATS keywords/i);
  assert.match(prompt, /Concrete technologies can be valuable Skills-only ATS coverage/i);
  assert.match(prompt, /weave them into the middle of the closest existing comma-separated skill list or category/i);
  assert.match(prompt, /tail-end clusters make the additions look pasted on/i);
  assert.match(prompt, /Skills placement/i);
  assert.match(prompt, /not for every phrase used to pepper the resume/i);
  assert.match(prompt, /already provided as job keywords/i);
  assert.match(prompt, /closest existing category/i);
  assert.match(prompt, /adjacent to the resume, USER\.md context, user-confirmed learnings/i);
  assert.match(prompt, /vague capability phrases used to pepper fit should not be added to Skills/i);
  assert.doesNotMatch(prompt, /RESTful/i);
  assert.equal(prompt.match(/Available tools:/g)?.length, 1);
  assert.match(prompt, /check_planned_keyword_assignments/i);
  assert.match(prompt, /\{ changes: \[\{ segmentId, editIntent, targetKeywords \}\] \}/i);
  assert.match(prompt, /assigned to planned segment edits/i);
  assert.match(prompt, /pushing high-priority assignments as far as truth, block scope, and layout allow/i);
  assert.match(prompt, /Step 4 writes the actual LaTeX and performs the final resume-text keyword coverage check/i);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumeTechnologyExtractionInstructions avoids priming specific narrative terms", () => {
  const prompt = buildTailorResumeTechnologyExtractionInstructions();

  assert.match(prompt, /actually present in the job posting/i);
  assert.match(prompt, /limited leeway for exact narrative phrases/i);
  assert.doesNotMatch(prompt, /RESTful/i);
});

test("buildTailorResumePlanningSystemPrompt only changes for Ludicrous Mode missing terms", () => {
  const settings = createDefaultSystemPromptSettings();
  const defaultPrompt = buildTailorResumePlanningSystemPrompt(settings, {});
  const emptyLudicrousPrompt = buildTailorResumePlanningSystemPrompt(settings, {
    ludicrousMissingSkillsSectionTerms: [],
  });
  const missingTermsPrompt = buildTailorResumePlanningSystemPrompt(settings, {
    ludicrousMissingSkillsSectionTerms: ["Kubernetes", "Terraform"],
  });

  assert.equal(emptyLudicrousPrompt, defaultPrompt);
  assert.match(
    missingTermsPrompt,
    /Ludicrous Mode missing skills-section terms:/,
  );
  assert.match(missingTermsPrompt, /Kubernetes, Terraform/);
  assert.match(missingTermsPrompt, /Take lots of liberty/i);
  assert.match(missingTermsPrompt, /real project/i);
});

test("buildTailorResumePlanningSystemPrompt appends skills keyword coverage to saved prompts", () => {
  const prompt = buildTailorResumePlanningSystemPrompt(
    mergeSystemPromptSettings({
      tailorResumePlanning: "Custom planning prompt.",
    }),
    {},
  );

  assert.match(prompt, /Custom planning prompt\./);
  assert.match(prompt, /Skills placement/i);
  assert.match(prompt, /If a concrete hard skill is adjacent to the resume or USER\.md context/i);
  assert.match(prompt, /Concrete technologies can be valuable Skills-only ATS coverage/i);
  assert.match(prompt, /broad API, infrastructure, fundamentals, or process wording/i);
  assert.doesNotMatch(prompt, /RESTful/i);
  assert.match(prompt, /Available tools:/);
  assert.match(prompt, /check_planned_keyword_assignments/i);
  assert.match(prompt, /list_current_resume_keyword_usage/i);
  assert.match(prompt, /list_malformed_resume_bullets/i);
  assert.match(prompt, /Coverage ambition/i);
  assert.match(prompt, /actively work through low-priority terms/i);
});

test("buildTailorResumePlanningSystemPrompt does not ask for job identifiers", () => {
  const prompt = buildTailorResumePlanningSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.doesNotMatch(prompt, /jobIdentifier/i);
});

test("buildTailorResumeInterviewSystemPrompt does not inject retry feedback", () => {
  const prompt = buildTailorResumeInterviewSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.doesNotMatch(prompt, /Previous interview feedback:/);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumeInterviewSystemPrompt keeps user-facing interview text concise and mirrored for rendering", () => {
  const prompt = buildTailorResumeInterviewSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.match(prompt, /rendered visibly in the chat UI/i);
  assert.match(prompt, /completionMessage/i);
  assert.match(prompt, /tool call is the control-plane output/i);
  assert.match(prompt, /ask all useful missing-technology questions together/i);
  assert.match(prompt, /Do not ask one technology per turn/i);
  assert.match(prompt, /initiate_tailor_resume_probing_questions/i);
  assert.match(prompt, /finish_tailor_resume_interview/i);
  assert.match(prompt, /update_tailor_resume_non_technologies/i);
  assert.match(prompt, /nonTechnologyTerms/i);
  assert.match(prompt, /non-technology list/i);
  assert.match(prompt, /case-insensitive deny-list/i);
  assert.match(prompt, /stored alongside USER\.md, not inside USER\.md/i);
  assert.match(prompt, /starts the remaining tailoring steps/i);
  assert.match(prompt, /sample, draft, clarification, or review/i);
  assert.match(prompt, /deterministic keyword presence/i);
  assert.match(prompt, /cannot cleanly assume the user's experience/i);
  assert.match(prompt, /internet terminology/i);
  assert.match(prompt, /one pointed direct question/i);
  assert.match(prompt, /where did you use them and what was the impact/i);
  assert.match(prompt, /Do not generate structured examples/i);
  assert.match(prompt, /Step 2 exists only to gather reusable context and update USER\.md/i);
  assert.match(prompt, /about what experience the user has/i);
  assert.match(prompt, /Never ask permission to update USER\.md after the user answers/i);
  assert.match(prompt, /updating USER\.md is the point of this chat/i);
  assert.match(prompt, /patch misses are not a reason to invalidate the Step 2 chat response/i);
  assert.match(prompt, /Do not ask whether to add, replace, append, insert, or swap resume bullets/i);
  assert.match(prompt, /placement decision belongs to Step 3 planning/i);
  assert.match(prompt, /gives quoted bullet text and names the employer/i);
  assert.match(prompt, /do not ask whether to add the confirmed bullets or where they should go/i);
  assert.match(prompt, /quoted user-confirmed experience-evidence bullets/i);
  assert.match(prompt, /technology-specific headings/i);
  assert.match(prompt, /Quoted bullets are user-confirmed experience evidence/i);
  assert.match(prompt, /not instructions to add, replace, append, insert, or swap/i);
  assert.match(prompt, /Step 3 planning decides whether that memory should become a skills entry/i);
  assert.match(prompt, /every durable fact from the entire chat/i);
  assert.match(prompt, /Do not write only the latest user message/i);
  assert.match(prompt, /Do not turn uncertain or adjacent experience into a quoted production-style claim/i);
  assert.match(prompt, /Unquoted bullets are factual notes or constraints/i);
  assert.match(prompt, /No direct production Cassandra experience/i);
  assert.match(prompt, /initiate_tailor_resume_probing_questions is presentation-only/i);
  assert.match(prompt, /finish_tailor_resume_interview is the only tool that writes USER\.md/i);
  assert.match(prompt, /No need to ask the user's permission to edit USER\.md/i);
  assert.match(prompt, /Step 2 records confirmed support/i);
  assert.match(prompt, /does not need to prove every job keyword is usable before finishing/i);
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
  assert.match(prompt, /debug-forced outside the tool arguments/i);
  assert.equal(prompt.includes("would_ask_without_debug"), false);
  assert.equal(prompt.includes("forced_only"), false);
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
  assert.match(prompt, /both high- and low-priority terms/i);
  assert.match(prompt, /low-priority terms assigned by Step 3 are active targets/i);
  assert.match(prompt, /targetKeywords as keyword guidance/i);
  assert.match(prompt, /editIntent and targetKeywords as the target visible outcome/i);
  assert.match(prompt, /Quoted bullets under technology headings are user-confirmed experience evidence/i);
  assert.match(prompt, /actual experience-bullet replacement/i);
  assert.match(prompt, /rather than downgrading it to a skills-only keyword/i);
  assert.match(prompt, /not placement instructions/i);
  assert.match(prompt, /Unquoted bullets are factual notes/i);
  assert.match(prompt, /use an empty latexCode when removal is clearly the right implementation/i);
  assert.match(prompt, /Do not leave an empty \\resumeitem\{\}/i);
  assert.match(prompt, /replaces a lower-signal bullet with user-confirmed technology experience/i);
  assert.match(prompt, /Do not move the technology only to skills/i);
  assert.match(prompt, /keep pushing keyword coverage for both high- and low-priority terms/i);
  assert.match(prompt, /preserve the planned entries that are actual skills/i);
  assert.match(prompt, /USER\.md is context, not a permission gate for adjacent Skills additions/i);
  assert.match(prompt, /Do not add vague capability phrases to Skills merely for keyword peppering/i);
  assert.match(prompt, /If the accepted plan adds actual skills to a skills section/i);
  assert.match(prompt, /weave them into the middle of the closest existing comma-separated skill list or category/i);
  assert.match(prompt, /Do not append all newly added keywords at the end/i);
  assert.match(prompt, /Do not introduce new capability keywords that are absent/i);
  assert.match(prompt, /Do not add extra capability phrases to Skills/i);
  assert.doesNotMatch(prompt, /RESTful/i);
  assert.match(prompt, /USER\.md-to-LaTeX formatting/i);
  assert.match(prompt, /Markdown bold emphasis/i);
  assert.match(prompt, /\\textbf\{word\}/);
  assert.match(prompt, /one or two specific job-emphasized technologies or capabilities/i);
  assert.match(prompt, /Do not bold the entire sentence/i);
  assert.match(prompt, /never add inline bolding inside Skills or Technical Skills sections/i);
  assert.equal(prompt.match(/Available tools:/g)?.length, 1);
  assert.match(prompt, /check_implemented_resume_keyword_coverage/i);
  assert.match(prompt, /first response should be a check_implemented_resume_keyword_coverage tool call/i);
  assert.match(prompt, /malformed rendered bullets/i);
  assert.match(prompt, /\{ changes: \[\{ segmentId, latexCode \}\], lineCountSegmentIds: \[\] \}/i);
  assert.match(prompt, /reports keyword coverage, rendered page count/i);
  assert.match(prompt, /Pass lineCountSegmentIds as \[\]/i);
  assert.match(prompt, /testing whether a missing keyword can fit without creating another rendered line/i);
  assert.match(prompt, /missing high- or low-priority keyword/i);
  assert.match(prompt, /Return final JSON only after coverage and changed-bullet health are acceptable/i);
  assert.equal(prompt.includes("{{FEEDBACK_BLOCK}}"), false);
});

test("buildTailorResumeImplementationSystemPrompt appends USER.md bolding guidance to saved prompts", () => {
  const prompt = buildTailorResumeImplementationSystemPrompt(
    mergeSystemPromptSettings({
      tailorResumeImplementation: "Custom implementation prompt.",
    }),
    {},
  );

  assert.match(prompt, /Custom implementation prompt\./);
  assert.match(prompt, /USER\.md is Markdown, not LaTeX/i);
  assert.match(prompt, /\\textbf\{\.\.\.\}/);
  assert.match(prompt, /Available tools:/);
  assert.match(prompt, /check_implemented_resume_keyword_coverage/i);
  assert.match(prompt, /first response should be a check_implemented_resume_keyword_coverage tool call/i);
  assert.match(prompt, /list_current_resume_keyword_usage/i);
  assert.match(prompt, /list_malformed_resume_bullets/i);
  assert.match(prompt, /missing high- or low-priority keyword/i);
  assert.match(prompt, /weave them into the middle of the closest existing comma-separated skill list or category/i);
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

test("buildTailorResumeRefinementSystemPrompt is optimistic about adjacent skills", () => {
  const prompt = buildTailorResumeRefinementSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.match(prompt, /Preserve factual accuracy without becoming defensive/i);
  assert.match(prompt, /be extremely optimistic about likely transferable experience/i);
  assert.match(prompt, /add concrete adjacent technologies to Skills or Technical Skills/i);
  assert.match(prompt, /the user's request is strong evidence of intent/i);
  assert.match(prompt, /apply the edit instead of refusing/i);
  assert.match(prompt, /Prefer Skills-section additions for adjacent or likely skills/i);
  assert.match(prompt, /USER\.md is context, not a gate for inclusion/i);
  assert.match(prompt, /it is a GOOD idea to pack concrete hard-skill keywords into Skills or Technical Skills/i);
  assert.match(prompt, /recommend adjacent concrete hard skills instead of saying they need bullet-level substantiation/i);
  assert.match(prompt, /If a revised bullet bolds a concrete hard-skill keyword/i);
  assert.match(prompt, /Skills keyword set should be a strict superset/i);
  assert.match(prompt, /missing Skills coverage for a bolded bullet keyword as something to fix/i);
  assert.match(prompt, /weave them into the middle of the closest existing comma-separated skill list or category/i);
  assert.match(prompt, /Do not append all newly added keywords at the end/i);
});

test("buildTailorResumeRefinementSystemPrompt appends skills keyword placement to saved prompts", () => {
  const prompt = buildTailorResumeRefinementSystemPrompt(
    mergeSystemPromptSettings({
      tailorResumeRefinement: "Custom refinement prompt.",
    }),
    {},
  );

  assert.match(prompt, /Custom refinement prompt\./);
  assert.match(prompt, /weave them into the middle of the closest existing comma-separated skill list or category/i);
  assert.match(prompt, /tail-end clusters make the additions look pasted on/i);
});

test("buildTailorResumeRefinementSystemPrompt does not announce empty edits", () => {
  const prompt = buildTailorResumeRefinementSystemPrompt(
    createDefaultSystemPromptSettings(),
    {},
  );

  assert.match(prompt, /Do not announce that no edits were applied/i);
  assert.match(prompt, /expected that no edits happen unless the user explicitly asks/i);
  assert.match(prompt, /Do not say "No edits applied"/i);
  assert.match(prompt, /Only mention that you edited the resume when you actually returned/i);
  assert.match(prompt, /answer the question directly and helpfully/i);
  assert.match(prompt, /Do not answer with process notes, tool status, or unchanged-block explanations/i);
  assert.match(prompt, /Answer the user's actual question first/i);
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
  assert.match(prompt, /weave them into the middle of the closest existing comma-separated skill list or category/i);
  assert.match(prompt, /do not append all newly added keywords at the end/i);
  assert.equal(prompt.includes("{{TARGET_PAGE_COUNT_REQUIREMENT}}"), false);
  assert.equal(prompt.includes("{{ESTIMATED_LINE_REDUCTION}}"), false);
});

test("buildTailorResumePageCountCompactionPrompt appends skills keyword placement to saved prompts", () => {
  const prompt = buildTailorResumePageCountCompactionPrompt(
    mergeSystemPromptSettings({
      tailorResumePageCountCompaction: "Custom page count prompt.",
    }),
    {
      currentPageCount: 2,
      estimatedLineReduction: 3,
      targetPageCount: 1,
    },
  );

  assert.match(prompt, /Custom page count prompt\./);
  assert.match(prompt, /weave them into the middle of the closest existing comma-separated skill list or category/i);
  assert.match(prompt, /tail-end clusters make the additions look pasted on/i);
});

test("buildTailorResumePageCountCompactionInstructions exposes resume inspection tools", () => {
  const instructions = buildTailorResumePageCountCompactionInstructions({
    lineReductionSubmissionToolName: "submit_verified_line_reductions",
    lineReductionToolName: "measure_resume_line_reductions",
    pageCountVerificationToolName: "verify_resume_page_count",
  });

  assert.match(instructions, /list_current_resume_keyword_usage/i);
  assert.match(instructions, /list_malformed_resume_bullets/i);
  assert.match(instructions, /weave them into the middle of the closest existing comma-separated skill list or category/i);
  assert.match(instructions, /most updated resume draft/i);
  assert.match(instructions, /malformed rendered bullet/i);
});
