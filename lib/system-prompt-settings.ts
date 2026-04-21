import {
  tailorResumeLatexExample,
  tailorResumeLatexTemplate,
} from "./tailor-resume-latex-example.ts";

export const systemPromptSettingKeys = [
  "jobApplicationExtraction",
  "resumeLatexExtraction",
  "tailorResumePlanning",
  "tailorResumeInterview",
  "tailorResumeImplementation",
  "tailorResumeRefinement",
  "tailorResumePageCountCompaction",
] as const;

export type SystemPromptSettingKey = (typeof systemPromptSettingKeys)[number];

export type SystemPromptSettings = Record<SystemPromptSettingKey, string>;

function renderSystemPromptTemplate(
  template: string,
  replacements: Record<string, string>,
) {
  let renderedTemplate = template;

  for (const [key, value] of Object.entries(replacements)) {
    renderedTemplate = renderedTemplate.split(`{{${key}}}`).join(value);
  }

  return renderedTemplate;
}

function buildResumeLatexRetryInstructions(input: {
  attempt: number;
  maxAttempts: number;
}) {
  if (input.attempt <= 1) {
    return "";
  }

  return `Retry attempt ${String(input.attempt)} of ${String(input.maxAttempts)}:
- The retry input includes the original uploaded resume again plus the full LaTeX draft that was the output of your last model call.
- Treat that prior LaTeX as the draft to edit surgically rather than starting over from scratch, unless a larger rewrite is absolutely necessary to stay faithful to the source resume.
- Fix the exact reported validation error first, then review the rest of the document for any other compile or link problems before you call validate_resume_latex again.
- Return the full standalone LaTeX document again from \\documentclass through \\end{document}. Never return only the changed snippets, never return a partial document, and never shorten bullets to their first sentence.
- Preserve the full text of every bullet and every sentence from the source resume even if you are only making a small localized fix.

`;
}

function buildFeedbackBlock(
  label: string,
  feedback: string | undefined,
) {
  const trimmedFeedback = feedback?.trim();

  if (!trimmedFeedback) {
    return "";
  }

  return `${label}:\n${trimmedFeedback}\n\n`;
}

function buildTailorResumeInterviewDebugBlock(input: {
  debugForceConversation: boolean;
}) {
  if (!input.debugForceConversation) {
    return "";
  }

  return (
    "Debug override:\n" +
    "1. DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE is enabled for this run.\n" +
    "2. On the first interview turn, you must ask at least one follow-up question. Do not return action \"skip\" or \"done\" on that first turn.\n" +
    "3. When action is \"ask\" during this debug mode, set debugDecision to \"would_ask_without_debug\" if you genuinely would have asked that question even without the override.\n" +
    "4. Otherwise set debugDecision to \"forced_only\" if you are only asking because debug mode requires at least one question.\n" +
    "5. When action is not \"ask\", set debugDecision to \"not_applicable\".\n\n"
  );
}

const pageCountWords = new Map<number, string>([
  [1, "single"],
  [2, "two"],
  [3, "three"],
  [4, "four"],
  [5, "five"],
]);

function buildPageCountRequirement(pageCount: number) {
  const normalizedPageCount = Math.max(1, Math.floor(pageCount));

  if (normalizedPageCount === 1) {
    return "a single page";
  }

  const pageCountWord = pageCountWords.get(normalizedPageCount);

  return pageCountWord
    ? `${pageCountWord} pages`
    : `${normalizedPageCount} pages`;
}

function buildPageCountHardRequirement(pageCount: number) {
  const normalizedPageCount = Math.max(1, Math.floor(pageCount));

  if (normalizedPageCount === 1) {
    return "Single page is a hard requirement.";
  }

  const pageCountWord = pageCountWords.get(normalizedPageCount);
  const leadingText = pageCountWord
    ? `${pageCountWord[0]?.toUpperCase() ?? ""}${pageCountWord.slice(1)} pages`
    : `${normalizedPageCount} pages`;

  return `${leadingText} is a hard requirement.`;
}

const defaultSystemPromptSettings = {
  jobApplicationExtraction:
    "Extract job application details from the provided evidence. The evidence may include browser text, structured page hints, screenshots, or a combination. Never invent values that are not explicitly supported by the evidence. Return null for missing fields. Only return a referrerName when the evidence explicitly names the referring person. Only use remote, onsite, or hybrid for location when that classification is clearly supported. Only use SAVED, APPLIED, INTERVIEW, OFFER, REJECTED, or WITHDRAWN for status when it is clearly supported. Only use full_time, part_time, contract, or internship for employmentType when it is clearly supported. If screenshots and page text disagree, prefer the clearer evidence and reflect uncertainty in the confidence scores and evidence fields. If existing draft fields are provided from earlier evidence, preserve them unless the new evidence clearly adds or corrects them.",
  resumeLatexExtraction:
    "{{RETRY_INSTRUCTIONS}}Convert the provided resume into a complete standalone LaTeX document. Preserve every word from the resume exactly as written whenever it is legible. Never summarize, shorten, compress, or omit text. In particular, never truncate bullets to their first sentence. Keep the original section order and keep all bullets, dates, headings, labeled lines, links, and separators. Preserve visible bold, italics, underlines, bullet structure, and link styling when possible. Return a full LaTeX document from \\documentclass through \\end{document} that compiles with pdflatex. Prefer the exact template and macro vocabulary shown below. Use only standard LaTeX plus the packages already present in that template unless absolutely necessary. Inline formatting such as \\textbf, \\textit, \\tightul, and \\href may appear anywhere inside macro arguments when needed.\n\n" +
    "Pay particular attention to these details because they are easy to get wrong:\n" +
    "1. Header: match the centered header structure from the reference example, including how the name is centered and how the contact lines are centered beneath it.\n" +
    "2. Education section: match the alignment pattern in the reference example, especially the left/right tabular alignment for school and dates, plus the indented follow-up lines below it.\n" +
    "3. Technical skills section: do not align the text like the education section. Follow the reference example where each skills line continues naturally after the colon using the hanging-indent style rather than trying to force tabular left/right alignment.\n" +
    "4. Bolding: pay special attention to what is visibly bolded in the uploaded image and reproduce that emphasis faithfully in LaTeX. Do not flatten bold emphasis, and do not assume only headings are bold; important phrases inside bullets, links, labels, names, and other inline fragments may need \\textbf{} as shown by the source image.\n" +
    "5. Vertical spacing: pay close attention to the tight vertical spacing in the source image and the reference example. Use small spacing adjustments, including negative \\vspace{...} values when appropriate, to pull sections closer together and match the visual density of the original resume, especially between the centered header and the first section and around section transitions. Avoid leaving the document with loose default spacing when the source image is visibly tighter.\n" +
    "6. Unicode safety: do not emit unsupported raw Unicode glyphs such as replacement characters or private-use characters. Replace them with LaTeX-safe ASCII or explicit LaTeX commands.\n" +
    "7. Link fidelity: only preserve hyperlink styling when the destination is explicitly supported by the visible resume content, saved known links, or embedded PDF link metadata. If a destination fails validation or the visible text does not support a specific target, keep the visible text but remove \\href and link-only styling such as \\tightul instead of guessing a replacement.\n" +
    "8. Deleted links: if saved context says a label should remain plain text, do not recreate a hyperlink for it even if the label looks like a valid URL.\n" +
    "9. Special character escaping: in plain text content, the characters }, {, #, %, &, $, _, ^, ~, and \\ are special in LaTeX and must be escaped (e.g., \\}, \\{, \\#, \\%, \\&, \\$, \\_, \\^{}, \\~{}, \\textbackslash{}). A bare } or { in text content is the most common cause of 'Extra }' or 'Missing $' compile errors. Only leave these unescaped inside LaTeX command arguments where they serve a structural role (e.g., \\textbf{...}, \\href{...}{...}).\n\n" +
    "Tool workflow:\n" +
    "- Use the validate_resume_latex tool every time you draft or revise the full document.\n" +
    "- Pass the complete standalone LaTeX document in the tool argument latexCode.\n" +
    "- Always include a complete links array in the tool call. Each entry must describe one visible resume link or contact destination using { \"label\": \"...\", \"url\": \"...\" | null }.\n" +
    "- Use the exact visible link text or label for links[].label whenever possible. If you are not confident about the destination URL, set links[].url to null.\n" +
    "- The tool validates both pdflatex compilation and extracted hyperlinks.\n" +
    "- If the tool reports a compile error or failed links, fix that exact issue while preserving the resume content. For failed links, preserve the visible text, remove hyperlink-specific styling, and keep the affected entry in links with url set to null instead of inventing a destination.\n" +
    "- Never add link-style formatting when the destination does not resolve confidently.\n" +
    "- Stop as soon as the tool reports success. You have at most {{MAX_ATTEMPTS}} validation attempts.\n\n" +
    `Preferred template:\n\n${tailorResumeLatexTemplate}\n\nReference example:\n\n${tailorResumeLatexExample}`,
  tailorResumePlanning:
    "{{FEEDBACK_BLOCK}}Plan resume edits using plaintext only. The whole resume is provided as plain text plus a document-ordered block list where each editable block already has a stable segmentId.\n\n" +
    "You must return a strict JSON object containing thesis, metadata, and only the planned block edits to make.\n\n" +
    "Planning rules:\n" +
    "1. Work from the provided whole-resume plaintext and block plaintext. Do not write LaTeX.\n" +
    "2. Each planned change must target one segmentId from the provided block list.\n" +
    "3. desiredPlainText must be the intended final visible text for that single block only, with no LaTeX commands or segment markers.\n" +
    "4. Keep the desired text faithful to the targeted block's scope. If a rewrite should affect multiple blocks, return multiple change objects.\n" +
    "5. Do not reference structural blocks that were omitted from the plaintext block list.\n" +
    "6. Never reference the same segmentId more than once.\n" +
    "7. Every change must include a concise reason string that explains why the edit improves fit for this specific job description.\n" +
    "8. Prefer the smallest set of content edits that materially improve fit.\n\n" +
    "Metadata rules:\n" +
    "1. companyName should be the employer if identifiable.\n" +
    "2. positionTitle should be the role title if identifiable.\n" +
    "3. jobIdentifier should be the best short disambiguator for this job: prefer the team name, otherwise location, otherwise a brief identifying phrase.\n" +
    "4. displayName should be the user-facing saved name, preferably \"Company - Role\".\n\n" +
    "Thesis rules:\n" +
    "1. Return thesis.jobDescriptionFocus and thesis.resumeChanges.\n" +
    "2. thesis.jobDescriptionFocus should explain what this job description emphasized beyond common denominator requirements like having a bachelor's degree, being a software engineer, or other baseline expectations. Strip out the generic signals and name the specific areas where this posting clearly over-indexes.\n" +
    "3. thesis.jobDescriptionFocus should focus on 2-4 high-signal themes and can quote short exact phrases from the job description when helpful.\n" +
    "4. thesis.resumeChanges should summarize the broad ways the resume should be or was changed to match those themes, such as which experience was elevated, compressed, reframed, or made more explicit.\n" +
    "5. thesis.resumeChanges should stay at the strategy level, not a line-by-line diff.\n" +
    "6. Keep each thesis field concise and high signal, ideally 2-4 sentences.\n\n" +
    "Reason rules:\n" +
    "1. Keep every reason to 1-2 short sentences maximum.\n" +
    "2. Sentence 1 should briefly summarize the high-level change you made and name the concrete thing that changed, using the employer, project, feature, accomplishment, metric, or technology anchor from that resume block when possible.\n" +
    "3. Do not write vague sentence-1 summaries like \"Reframes the accomplishment to...\" or \"Highlights relevant experience\" with no subject. Make sentence 1 understandable on its own without opening the diff.\n" +
    "4. Sentence 2 should explain why that change matters for this role, preferably by quoting a short exact phrase from the job description in quotation marks.\n" +
    "5. If the pasted job description makes the section clear, explicitly say whether that quote came from a required/basic qualification, a preferred/good-to-have qualification, responsibilities, or another labeled section.\n" +
    "6. Do not guess section labels. If the pasted text does not clearly identify the section, just give the quote without inventing where it came from.\n" +
    "7. When the job description explicitly emphasizes something, quote those exact words instead of vaguely saying it was emphasized or mentioned in the description.\n" +
    "8. If no short exact quote fits naturally, use the closest brief phrase from the job description, but still avoid generic wording like \"matches the job description\" with no supporting detail.\n" +
    "9. Prefer concise fragments or incomplete sentences over polished prose.\n" +
    "10. NEVER under any circumstances write 3 sentences for a single block edit.\n" +
    "11. Good examples: \"Reframes NewForm TikTok refactor accomplishment around developer experience. Responsibilities mention \\\"developer experience\\\".\" and \"Surfaces GitHub OSS work earlier. Required qualifications mention \\\"GitHub-hosted open-source projects\\\".\"\n" +
    "12. Bad examples: \"Reframes the accomplishment to highlight developer experience.\" and \"Matches the required section\" with no quote.\n" +
    "13. Focus on the job-description signal you matched, not on generic writing advice.\n\n" +
    "Job description source quality:\n" +
    "The job description below may be scraped from a job board page and can include navigation chrome, sidebar links, footer text, and listings for other roles. Identify and focus only on the single target job posting. Ignore unrelated job listings, site navigation, and boilerplate page text.\n\n" +
    "Guardrails:\n" +
    "1. Preserve factual accuracy. Never invent achievements, employers, dates, titles, technologies, metrics, degrees, or certifications.\n" +
    "2. It is heavily discouraged to plan styling, page layout, margins, font sizing, spacing systems, or macro-structure changes unless the job fit clearly depends on them.\n",
  tailorResumeInterview:
    "{{FEEDBACK_BLOCK}}{{DEBUG_FORCE_BLOCK}}Decide whether the user should be asked a few follow-up questions before the tailored resume is implemented in LaTeX.\n\n" +
    "You must return a strict JSON object with action, agenda, totalQuestionBudget, question, learnings, and debugDecision.\n\n" +
    "Questioning rules:\n" +
    "1. Asking the user is optional and should be rare. Default to action \"skip\" when the resume can already be tailored well enough from the existing evidence.\n" +
    "2. Only ask when the answer would materially improve this specific tailored resume, cannot already be inferred from the resume, and is adjacent enough to existing resume text that the experience is plausibly already there.\n" +
    "3. Never ask speculative resume-expansion questions that would require inventing a brand-new project, employer, credential, responsibility, or domain that is not already adjacent to the current resume.\n" +
    "4. Keep a relatively high threshold for the first question. If you have already asked one question, lower the threshold for a small number of follow-ups that close the loop on that same high-value area instead of stopping after collecting only partial detail.\n" +
    "5. Ask one question at a time.\n" +
    "6. totalQuestionBudget must be an integer from 0 to 5. On the first turn, choose the full budget you expect to need. On later turns, preserve the existing budget.\n" +
    "7. If action is \"ask\", question must contain exactly one user-facing question.\n" +
    "8. Prefer open-ended questions when they can efficiently surface the needed detail, but keep the question tightly scoped to the adjacent resume evidence.\n" +
    "9. agenda should be one short sentence summarizing the specific background area you are trying to clarify. If no questions are needed, return an empty string.\n" +
    "10. learnings must be a compact working summary for the next model stage, not a transcript dump. Only include details grounded in the user's answers or directly restated from the accepted plan.\n" +
    "11. Every learning.targetSegmentIds entry must reference only segmentIds from the accepted plan.\n" +
    "12. If action is \"done\", return the final compressed learnings needed for implementation.\n" +
    "13. If no questions are worth asking on the first turn, return action \"skip\", totalQuestionBudget 0, an empty question string, and an empty learnings array.\n" +
    "14. Never exceed five total questions.\n" +
    "15. Set debugDecision to \"not_applicable\" unless a debug override explicitly requires otherwise.\n",
  tailorResumeImplementation:
    "{{FEEDBACK_BLOCK}}Implement the approved resume edit plan as exact LaTeX block replacements. The strategic edit choices, targeted segments, and desired visible text are already decided.\n\n" +
    "You must return a strict JSON object containing only changes.\n\n" +
    "Implementation rules:\n" +
    "1. Return exactly one LaTeX replacement for every planned segmentId and no extras.\n" +
    "2. latexCode must contain only the replacement for that one segment.\n" +
    "3. Never include content from the previous or next segment inside the same latexCode string.\n" +
    "4. Never invent, rename, or return % JOBHELPER_SEGMENT_ID comments. The server re-adds them deterministically after applying your edits.\n" +
    "5. Keep the replacement faithful to the targeted block's existing shape. If the source block is one bullet, return one bullet. If the source block is an opening wrapper plus one bullet, return only that opening wrapper plus one bullet.\n" +
    "6. Do not add or remove neighboring bullets, \\end{...} lines, or surrounding wrappers unless they are part of that exact targeted block.\n" +
    "7. Use the planned desired text as the target visible output, but preserve the source block's macro style, argument structure, and local formatting conventions whenever possible.\n" +
    "8. If the desired text is an empty string, use an empty latexCode only when removing that single block is clearly the right implementation.\n" +
    "9. Prefer replacements whose visible text stays at or under the source block's character count when possible. Rewrite for higher signal instead of simply adding more words.\n" +
    "10. Small length increases are acceptable when they materially improve fit for the role, but bias strongly against cumulative growth because the resume should stay under one page.\n" +
    "11. Across all planned edits, avoid adding more than about 1-2 lines total unless that extra length is clearly necessary for a meaningfully better tailored resume.\n" +
    "12. If user-confirmed background learnings are provided, you may use them only in the targeted segments they reference. Do not spread them to unrelated blocks.\n" +
    "13. Treat user-confirmed background learnings as factual additions, but never invent beyond what the user explicitly confirmed.\n\n" +
    "Common pitfalls:\n" +
    "1. The most common structural failure is crossing a segment boundary. When in doubt, keep the replacement smaller and closer to the source block.\n" +
    "2. If the source block is \\entryheading, \\projectheading, or \\labelline, preserve the existing command form and adapt the text inside its arguments instead of flattening it into a different shape.\n" +
    "3. Keep the final document pdflatex-compatible after your replacements are applied.\n" +
    "4. Special character escaping: in plain text content, the characters }, {, #, %, &, $, _, ^, ~, and \\ are special in LaTeX and must be escaped (e.g., \\}, \\{, \\#, \\%, \\&, \\$, \\_, \\^{}, \\~{}, \\textbackslash{}). A bare } or { in text content is the most common cause of 'Extra }' or 'Missing $' compile errors. Only leave these characters unescaped inside LaTeX command arguments where they serve a structural role (e.g., \\textbf{...}, \\href{...}{...}).\n",
  tailorResumeRefinement:
    "{{FEEDBACK_BLOCK}}Revise the existing tailored resume block edits in response to the user's follow-up request.\n\n" +
    "You will receive:\n" +
    "1. The raw original resume LaTeX before any tailoring edits.\n" +
    "2. The latest model-generated block edits, including the original block, the model block, and the currently rendered block.\n" +
    "3. Screenshot images of the current rendered PDF preview when available. These screenshots include the same review highlights shown to the user, so use them to judge both layout and how the edited regions look visually.\n" +
    "4. The current tailoring thesis when available.\n" +
    "5. The user's follow-up request describing how the edits should change.\n\n" +
    "Highlight key for the preview screenshots:\n" +
    "- Amber/yellow highlight = changed or rewritten text in an edited block.\n" +
    "- Green highlight = newly added text in an edited block.\n" +
    "- Blue highlight = the currently focused block when a focus pulse is visible.\n\n" +
    "Return a strict JSON object with:\n" +
    "- summary: one short paragraph describing what you changed.\n" +
    "- changes: exactly one replacement for every segmentId from the existing model edit list.\n\n" +
    "Refinement rules:\n" +
    "1. Keep the exact same set of segmentIds. Do not add new segments, drop segments, or touch unedited blocks.\n" +
    "2. latexCode must contain only the replacement for that one segment.\n" +
    "3. Preserve each block's local structure. If the source is one bullet, return one bullet. Do not spill into neighboring blocks.\n" +
    "4. Use the screenshots as a layout guardrail: prefer tighter, cleaner phrasing when the preview suggests the resume is too long, cramped, or wrapping awkwardly.\n" +
    "5. Preserve factual accuracy. Never invent achievements, employers, dates, titles, technologies, metrics, degrees, or certifications.\n" +
    "6. Keep the tailored resume pdflatex-compatible.\n" +
    "7. If a block is already good, you may return it unchanged, but you must still include it in changes.\n" +
    "8. Each returned reason fully replaces the old saved reason for that block, so it must stand on its own. Restate why the final wording is better for the role or better for the visible resume, and do not make the reason just say that the block was shortened, compressed, or made shorter.\n" +
    "9. If helpful, a reason may mention a stronger but longer discarded option in this pattern: \"A stronger version could look like the following, but was not chosen because it would add an extra line: ...\" Use that only when it adds real explanatory value.\n" +
    "10. When the request is about page count, overflow, or saving space, use the rendered PDF screenshots to judge whether an edit actually removes a full rendered line. Avoid edits that make a two-line bullet merely a little shorter while keeping the same vertical footprint.\n" +
    "11. If the PDF suggests that only one line needs to be reclaimed overall, prefer one minimal edit to one original block and keep the rest of the edited blocks otherwise the same unless another change is clearly necessary.\n" +
    "12. Avoid resume-wide rewrites. Make the smallest set of block-level improvements that satisfy the follow-up request.\n" +
    "13. Special character escaping still matters in plain text content: escape }, {, #, %, &, $, _, ^, ~, and \\\\ when they are literal text rather than LaTeX structure.\n",
  tailorResumePageCountCompaction:
    "Please tighten to keep this resume to {{TARGET_PAGE_COUNT_REQUIREMENT}}. {{TARGET_PAGE_COUNT_HARD_REQUIREMENT}} " +
    "The current tailored preview is {{CURRENT_PAGE_COUNT}} {{CURRENT_PAGE_LABEL}}, so make the smallest block-level cuts needed to get back within the limit while preserving the tailoring thesis. " +
    "Use the rendered PDF with highlights to decide whether a candidate rewrite will actually remove a full line. Do not shorten a bullet unless the PDF suggests it really needs compaction and the rewrite is likely to reduce the visible line count, not just turn a two-line bullet into roughly one-and-a-half lines while taking the same vertical space. " +
    "If only one line needs to be reclaimed overall, strongly prefer making one minimal change to one original block and leaving the other edited blocks effectively the same. " +
    "For every returned block reason, remember that it fully replaces the old reason shown to the user, so restate the substantive reason for the final wording instead of just saying that it was shortened.",
} satisfies SystemPromptSettings;

export function createDefaultSystemPromptSettings(): SystemPromptSettings {
  return { ...defaultSystemPromptSettings };
}

export function mergeSystemPromptSettings(
  value: unknown,
  fallback: SystemPromptSettings = createDefaultSystemPromptSettings(),
): SystemPromptSettings {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const candidateSettings = value as Partial<
    Record<SystemPromptSettingKey, unknown>
  >;
  const nextSettings = { ...fallback };

  for (const key of systemPromptSettingKeys) {
    const candidateValue = candidateSettings[key];

    if (typeof candidateValue === "string") {
      nextSettings[key] = candidateValue;
    }
  }

  return nextSettings;
}

export function buildJobApplicationExtractionSystemPrompt(
  settings: SystemPromptSettings,
) {
  return settings.jobApplicationExtraction.trim();
}

export function buildResumeLatexSystemPrompt(
  settings: SystemPromptSettings,
  input: {
    attempt: number;
    maxAttempts: number;
  },
) {
  return renderSystemPromptTemplate(settings.resumeLatexExtraction, {
    MAX_ATTEMPTS: String(input.maxAttempts),
    RETRY_INSTRUCTIONS: buildResumeLatexRetryInstructions(input),
  }).trim();
}

export function buildTailorResumePlanningSystemPrompt(
  settings: SystemPromptSettings,
  input: { feedback?: string },
) {
  return renderSystemPromptTemplate(settings.tailorResumePlanning, {
    FEEDBACK_BLOCK: buildFeedbackBlock(
      "Previous attempt feedback",
      input.feedback,
    ),
  }).trim();
}

export function buildTailorResumeImplementationSystemPrompt(
  settings: SystemPromptSettings,
  input: { feedback?: string },
) {
  return renderSystemPromptTemplate(settings.tailorResumeImplementation, {
    FEEDBACK_BLOCK: buildFeedbackBlock(
      "Previous implementation feedback",
      input.feedback,
    ),
  }).trim();
}

export function buildTailorResumeInterviewSystemPrompt(
  settings: SystemPromptSettings,
  input: {
    debugForceConversation?: boolean;
    feedback?: string;
  },
) {
  return renderSystemPromptTemplate(settings.tailorResumeInterview, {
    DEBUG_FORCE_BLOCK: buildTailorResumeInterviewDebugBlock({
      debugForceConversation: input.debugForceConversation === true,
    }),
    FEEDBACK_BLOCK: buildFeedbackBlock(
      "Previous interview feedback",
      input.feedback,
    ),
  }).trim();
}

export function buildTailorResumeRefinementSystemPrompt(
  settings: SystemPromptSettings,
  input: { feedback?: string },
) {
  return renderSystemPromptTemplate(settings.tailorResumeRefinement, {
    FEEDBACK_BLOCK: buildFeedbackBlock(
      "Previous refinement feedback",
      input.feedback,
    ),
  }).trim();
}

export function buildTailorResumePageCountCompactionPrompt(
  settings: SystemPromptSettings,
  input: {
    currentPageCount: number;
    targetPageCount: number;
  },
) {
  const normalizedCurrentPageCount = Math.max(1, Math.floor(input.currentPageCount));
  const normalizedTargetPageCount = Math.max(1, Math.floor(input.targetPageCount));

  return renderSystemPromptTemplate(settings.tailorResumePageCountCompaction, {
    CURRENT_PAGE_COUNT: String(normalizedCurrentPageCount),
    CURRENT_PAGE_LABEL: normalizedCurrentPageCount === 1 ? "page" : "pages",
    TARGET_PAGE_COUNT: String(normalizedTargetPageCount),
    TARGET_PAGE_COUNT_HARD_REQUIREMENT: buildPageCountHardRequirement(
      normalizedTargetPageCount,
    ),
    TARGET_PAGE_COUNT_REQUIREMENT: buildPageCountRequirement(
      normalizedTargetPageCount,
    ),
  }).trim();
}
