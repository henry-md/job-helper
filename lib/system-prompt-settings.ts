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

const jobApplicationExtractionTitleTeamInstruction =
  'When a visible job title includes or is clearly paired with a short team name, prefer jobTitle in the format "Role (Team)" with only a 1-2 word parenthetical, for example "Software Engineer (Quantum)". If no short visible team name is provided, return the plain role title with no parentheses. Keep teamOrDepartment as the separate field for the fuller team or department name when it is visible.';

function ensureJobApplicationExtractionPromptRules(prompt: string) {
  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.includes(jobApplicationExtractionTitleTeamInstruction)) {
    return trimmedPrompt;
  }

  return `${trimmedPrompt} ${jobApplicationExtractionTitleTeamInstruction}`;
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
    "2. On the first interview turn, you must ask at least one follow-up question. Do not call skip_tailor_resume_interview or finish_tailor_resume_interview on that first turn.\n" +
    "3. When you call initiate_tailor_resume_probing_questions during this debug mode, set debugDecision to \"would_ask_without_debug\" if you genuinely would have asked that question even without the override.\n" +
    "4. Otherwise set debugDecision to \"forced_only\" if you are only asking because debug mode requires at least one question.\n" +
    "5. When you call any other interview tool, set debugDecision to \"not_applicable\" if that tool accepts debugDecision.\n\n"
  );
}

function buildTailorResumeInterviewToolContractBlock() {
  return (
    "Current interview tool contract:\n" +
    "1. Call exactly one interview tool on every turn.\n" +
    "2. The tool call is the control-plane output and its assistantMessage, completionMessage, and technologyContexts are rendered visibly in the chat UI. Treat those fields as user-facing display content, not hidden metadata.\n" +
    "3. For initiate_tailor_resume_probing_questions, put the concise question text in assistantMessage. If you also emit normal assistant text, it must be the same concise question only; never repeat definitions, examples, or technologyContexts content outside the tool call.\n" +
    "4. For finish_tailor_resume_interview, put the concise finish prompt in completionMessage. If you also emit normal assistant text, it must be the same concise completion only.\n" +
    "5. Use initiate_tailor_resume_probing_questions to keep the chat open. On the first ask turn, ask all useful technology questions together in one grouped message instead of opening a multi-turn checklist.\n" +
    "6. If the latest user answer asks you for a sample bullet, example, draft, clarification, or review, keep the chat open with initiate_tailor_resume_probing_questions. For technology bullet examples, use technologyContexts so the app renders them as collapsible cards; keep assistantMessage to a concise setup or confirmation question. For non-technology replies, answer directly in assistantMessage, then ask one concise confirmation or correction question if more detail is still needed. Do not ask whether to add, replace, append, insert, or swap resume bullets; that placement decision belongs to Step 3 planning.\n" +
    "7. Use finish_tailor_resume_interview only after an interview has already started and only when you want the user to decide whether the chat should end. The app will ask the user to press Done or keep chatting; your tool call does not end the chat by itself.\n" +
    "8. Use skip_tailor_resume_interview only on the first turn when no interview should start at all, and do not write assistant text for skip.\n" +
    "9. initiate_tailor_resume_probing_questions may edit USER.md only after the user has answered and only for durable facts that answer added. Use an empty userMarkdownEditOperations array for the first ask turn and for any ask turn that does not add durable memory. skip_tailor_resume_interview must always use an empty userMarkdownEditOperations array.\n" +
    "10. If userMarkdownEditOperations is non-empty, the user-facing assistantMessage or completionMessage must explicitly say that you are updating USER.md.\n" +
    "11. USER.md edit operations are transactional markdown patches. Supported op values are append, replace_exact, insert_before, insert_after, and delete_exact.\n" +
    "12. For append, set headingPath to the section path you want and markdown to the exact markdown to add. The app will create missing headings. Leave oldMarkdown, newMarkdown, and anchorMarkdown empty strings.\n" +
    "13. For replace_exact, set oldMarkdown and newMarkdown. For insert_before/insert_after, set anchorMarkdown and markdown. For delete_exact, set markdown. Exact-match operations must match exactly once or the app will feed back an error for retry.\n" +
    "14. Never put placeholders such as \"... rest unchanged\" or \"[existing content]\" inside USER.md edit fields.\n"
  );
}

function buildTailorResumePlanningOutputContractBlock() {
  return (
    "Current planning output contract:\n" +
    "1. Return emphasizedTechnologies as an array, even when it is empty.\n" +
    "2. Each emphasizedTechnologies item must include name, priority, and evidence.\n" +
    "3. priority must be exactly high or low.\n" +
    "4. Use emphasizedTechnologies only for resume-searchable skills: concrete technologies, programming languages, frameworks, libraries, databases, infrastructure tools, technical methods, or multi-word technical capability phrases that the employer is plausibly looking for on a candidate resume.\n" +
    "5. Do not extract company-specific internal products, product suites, platform names, customer-facing product brands, team names, mission names, or nouns that only describe what the company builds. Skip employer-branded terms unless the posting explicitly asks candidates to have prior experience using that product.\n" +
    "6. Infer priority from the posting: high for required/basic/minimum terms, repeated terms, title/team-defining terms, and strongly emphasized preferred terms; low for weaker preferred, nice-to-have, incidental, or broad ecosystem terms.\n" +
    "7. Return one atomic technology per item. Hard rule: if a slash, comma, parenthetical, or grouped phrase separates two distinct technologies, you must return separate emphasizedTechnologies items for each named technology, such as TypeScript and JavaScript instead of TypeScript/JavaScript, and React and Next.js instead of React / Next.js.\n" +
    "8. Do not replace named skills with broad group labels when the posting names specific technologies; include the specific names.\n" +
    "9. Prefer the core technology term and remove interchangeable vendor or marketing fluff when the inner term is what people actually list on resumes. For example, return Visual Studio instead of Microsoft Visual Studio. We need the smaller stable term so deterministic string matching can find it in resumes.\n" +
    "10. Do not return section-label fields. Keep section/source context only in evidence.\n"
  );
}

function buildTailorResumeInterviewTechnologyContextBlock() {
  return (
    "Current emphasized-technology context:\n" +
    "The input includes deterministic keyword presence for the original resume and USER.md. Use that model-only context as the main Step 2 clarification decision anchor after Step 1 keyword scraping and before Step 3 planning runs. It is okay to tell the user that a skill was not found in the resume or USER.md, but do not expose raw analysis fields. Strongly prefer asking when a concrete job technology is missing from both the original resume and USER.md and you cannot cleanly assume the user's experience yourself. Skip questions for vague, generic, or low-value terms such as broad practices, collaboration traits, or phrases like internet terminology. Include low-priority missing terms in the grouped question only when they are concrete and share an obvious likely insertion point with stronger terms. Group ask-worthy missing technologies into one pointed question, such as \"Do you have experience with Go, Cassandra, or Spark?\" and give each technology a one-sentence explanation plus two unlabeled resume examples that include the exact keyword. Keep example bullets inside the per-technology sections, not in the intro. Example bullets must be ideal FAANG-level resume bullets: concise action + technical scope + positive result in the same sentence, preferably with a metric. If an example bullet uses a dash suffix, the text after the dash must be the existing resume company/project/experience name where the bullet would fit, such as `-- NewForm`, not the technology name. If no likely resume company/project is clear, omit the dash suffix entirely.\n"
  );
}

function buildTailorResumeInterviewUserMarkdownMemoryBlock() {
  return (
    "Current USER.md technology-memory format:\n" +
    "1. When finish_tailor_resume_interview writes USER.md, organize technology learnings under technology-specific headings such as \"## Cassandra\" or \"## Spark\" unless the current USER.md already has a clearly equivalent section.\n" +
    "2. Under each technology heading, write separate markdown bullets. End bullets that map to a specific employer/project/experience with `-- ExperienceName`, for example `-- KnoWhiz` or `-- NewForm`.\n" +
    "3. Quoted bullets are user-confirmed experience evidence written in resume-bullet shape. Put the entire candidate bullet text in double quotes, then add `-- ExperienceName`. They are durable USER.md context for Step 3 planning, not instructions to add, replace, append, insert, or swap a resume bullet in Step 2.\n" +
    "4. Do not turn uncertain or adjacent experience into a quoted production-style claim. If the user only confirmed adjacency, familiarity, or that the technology can be listed in skills, write an unquoted factual note instead.\n" +
    "5. Unquoted bullets are factual notes or constraints, not exact candidate resume wording. Use them for no-experience notes, skills-only permissions, adjacent exposure, uncertainty, or constraints such as `No direct production Cassandra experience.` or `Can list Gradle in build tools skills; used adjacent Java build automation, but did not confirm Gradle project work.`\n" +
    "6. For each technology asked about in the chat, record one of: no user experience; can list in the skills section; or one or more quoted user-confirmed experience-evidence bullets tied to the relevant employer/project/experience. Include the skills-section category when the technology can be added there. Step 3 planning decides whether that memory should become a skills entry, a replacement bullet, an appended bullet, or no resume edit.\n" +
    "7. Preserve the distinction between direct experience and adjacency. Never write `production`, scale metrics, ownership, or exact technologies into a quoted bullet unless the user confirmed those details.\n"
  );
}

function buildTailorResumeImplementationTechnologyContextBlock() {
  return (
    "Current emphasized-technology context:\n" +
    "The input includes technologies emphasized by the job description with high/low priority. Include high-priority exact technology keywords wherever they are already supported by the resume, USER.md, user-confirmed interview learnings, or the accepted planned desired text. Use low-priority terms only when they fit naturally. Do not invent unsupported technology experience, and do not edit unplanned blocks.\n\n" +
    "USER.md technology-memory semantics:\n" +
    "Quoted bullets under technology headings are user-confirmed experience evidence tied to the experience after `-- ExperienceName`; treat them as grounded starting points that Step 3 planning may adapt into skills entries or block edits. They are not placement instructions by themselves. If the accepted plan uses a quoted USER.md bullet as experience evidence, implement that planned block edit as an actual experience-bullet replacement rather than downgrading it to a skills-only keyword. Unquoted bullets are factual notes, constraints, skills-only permissions, adjacency notes, or no-experience statements; do not turn them into exact resume claims unless the note explicitly supports that claim.\n"
  );
}

function buildTailorResumePlanningTechnologyContextBlock() {
  return (
    "Current USER.md and Step 2 technology-learning semantics:\n" +
    "1. Quoted bullets under technology-specific USER.md headings are user-confirmed experience evidence tied to the employer, project, or experience named after `-- ExperienceName`. Treat those quoted bullets as strong grounded candidates for experience-bullet edits when the job description emphasizes that technology.\n" +
    "2. Do not satisfy a user-confirmed technology only by adding it to the skills section when USER.md also provides a quoted candidate experience bullet for that technology. Prefer an experience-bullet replacement or swap in the matching employer/project/experience, and add the skills keyword only as a secondary edit when useful.\n" +
    "3. The implementation stage is segment-safe and normally replaces one existing block at a time. To add a new bullet-shaped experience from USER.md, plan it as a swap: choose the weakest or least job-relevant existing bullet in the same experience and set desiredPlainText to the adapted user-confirmed bullet. Do not ask Step 4 to invent a brand-new neighboring bullet outside the targeted segment.\n" +
    "4. If an existing bullet is low-value for this role and should simply disappear, you may plan deletion by setting desiredPlainText to an empty string for that single bullet segment. Use this only for an entire bullet/line segment, not for structural wrappers.\n" +
    "5. Unquoted USER.md notes are constraints, skills-only permissions, adjacency notes, or no-experience statements. Use them conservatively; do not convert adjacency or skills-only permission into an experience bullet unless the note explicitly supports that claim.\n"
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
    ensureJobApplicationExtractionPromptRules(
      "Extract job application details from the provided screenshot evidence. Never invent values that are not explicitly supported by the evidence. Return null for missing fields. Only return a referrerName when the evidence explicitly names the referring person. Only use remote, onsite, or hybrid for location when that classification is clearly supported. Only use SAVED, APPLIED, INTERVIEW, OFFER, REJECTED, or WITHDRAWN for status when it is clearly supported. Only use full_time, part_time, contract, or internship for employmentType when it is clearly supported. If existing draft fields are provided from earlier evidence, preserve them unless the new screenshot clearly adds or corrects them.",
    ),
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
    "You must return a strict JSON object containing thesis, metadata, emphasizedTechnologies, and only the planned block edits to make.\n\n" +
    "Planning rules:\n" +
    "1. Work from the provided whole-resume plaintext and block plaintext. Do not write LaTeX.\n" +
    "2. Each planned change must target one segmentId from the provided block list.\n" +
    "3. desiredPlainText must be the intended final visible text for that single block only, with no LaTeX commands or segment markers.\n" +
    "4. Keep the desired text faithful to the targeted block's scope. If a rewrite should affect multiple blocks, return multiple change objects.\n" +
    "5. Do not reference structural blocks that were omitted from the plaintext block list.\n" +
    "6. Never reference the same segmentId more than once.\n" +
    "7. Every change must include a concise reason string that explains why the edit improves fit for this specific job description.\n" +
    "8. Prefer the smallest set of content edits that materially improve fit.\n" +
    "9. When USER.md contains quoted experience evidence for a job-emphasized technology, strongly consider targeting the matching experience bullet instead of only editing the technical skills section.\n" +
    "10. Because implementation is block-scoped, plan new bullet-shaped evidence as a replacement/swap for an existing lower-signal bullet in the same experience whenever possible. Use an empty desiredPlainText only when deleting one whole bullet or line is the intended edit.\n\n" +
    "Metadata rules:\n" +
    "1. companyName should be the employer if identifiable.\n" +
    "2. positionTitle should be the role title if identifiable.\n" +
    "3. displayName should be the user-facing saved name, preferably \"Company - Role\".\n\n" +
    "Thesis rules:\n" +
    "1. Return thesis.jobDescriptionFocus and thesis.resumeChanges.\n" +
    "2. thesis.jobDescriptionFocus should explain what this job description emphasized beyond common denominator requirements like having a bachelor's degree, being a software engineer, or other baseline expectations. Strip out the generic signals and name the specific areas where this posting clearly over-indexes.\n" +
    "3. thesis.jobDescriptionFocus should focus on 2-4 high-signal themes and can quote short exact phrases from the job description when helpful.\n" +
    "4. thesis.resumeChanges should summarize the broad ways the resume should be or was changed to match those themes, such as which experience was elevated, compressed, reframed, or made more explicit.\n" +
    "5. thesis.resumeChanges should stay at the strategy level, not a line-by-line diff.\n" +
    "6. Keep each thesis field concise and high signal, ideally 2-4 sentences.\n\n" +
    "Technology emphasis rules:\n" +
    "1. Return emphasizedTechnologies as a deduped list of resume-searchable skills the job description emphasizes. Include concrete technologies, programming languages, frameworks, libraries, databases, infrastructure tools, technical methods, and multi-word technical capability phrases such as cloud infrastructure when they are plausibly something the employer wants to see on a resume.\n" +
    "2. Pay special attention to sections labeled required, basic, minimum, preferred, nice-to-have, or similar when extracting the list. Include every resume-searchable technology named in required/basic/minimum sections, not just a representative subset.\n" +
    "3. Do not include every incidental tool from navigation, boilerplate, benefits, equal-opportunity text, or unrelated roles on the scraped page.\n" +
    "4. Do not extract company-specific internal products, product suites, platform names, customer-facing product brands, team names, mission names, or nouns that only describe what the company builds. Skip employer-branded terms unless the posting explicitly asks candidates to have prior experience using that product. A term should survive only if a realistic candidate might already list it on their resume as a skill or experience area.\n" +
    "5. Preserve exact technology names and capitalization when possible.\n" +
    "6. Mark priority high for required/basic/minimum technologies, repeated technologies, title/team-defining technologies, and unusually strong preferred signals. Mark priority low for weaker preferred, nice-to-have, incidental, or broad ecosystem terms.\n" +
    "7. Return one atomic technology per item. Hard rule: if a slash, comma, parenthetical, or grouped phrase separates distinct technologies, you must return separate emphasizedTechnologies items for each named technology, such as TypeScript and JavaScript instead of TypeScript/JavaScript, React and Next.js instead of React / Next.js, and Python, Java, C++ as three items. Do not use a broad wrapper label such as front-end frameworks when the posting names specific frameworks.\n" +
    "8. Prefer the core technology term and remove interchangeable vendor or marketing fluff when the inner term is what people actually list on resumes. For example, return Visual Studio instead of Microsoft Visual Studio. We need the smaller stable term so deterministic string matching can find it in resumes.\n" +
    "9. When choosing planned changes, include high-priority technology keywords when the resume, USER.md, Step 2 user-confirmed learnings, or existing block text already supports them. Do not invent unconfirmed technology experience.\n\n" +
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
    "{{FEEDBACK_BLOCK}}{{DEBUG_FORCE_BLOCK}}Decide whether the user should be asked a few follow-up questions before the tailored resume is planned and implemented in LaTeX. Step 2 exists only to gather reusable context and update USER.md; it must not decide how to tailor the resume.\n\n" +
    "Use the available interview tools instead of returning plain JSON.\n\n" +
    "Questioning rules:\n" +
    "1. Asking the user is optional, but do not make the threshold so high that important job technologies stay missing. Default to asking when the deterministic keyword context says a concrete technology is missing from both the original resume and USER.md and you cannot cleanly assume the user's experience yourself.\n" +
    "2. Only ask when the answer would materially improve the context available for this specific tailored resume, cannot already be inferred from the resume or USER.md, and would let Step 3 later decide whether a missing keyword is truthful for skills or experience content.\n" +
    "3. For technology questions, ask about concrete close neighbors of resume-supported experience that also appear in the job description, such as a job-specific JavaScript framework when the resume shows substantial JavaScript work, Go beside backend/API work, Cassandra or Spark beside distributed systems/data infrastructure, or C when the resume lists C++. Do not ask about vague umbrella phrases, generic practices, or low-signal keywords just because the job description mentions them.\n" +
    "4. Use the deterministic keyword presence context to prioritize gaps. High-priority missing concrete technologies should usually be asked together unless USER.md already clearly answers them or the resume evidence makes the experience cleanly inferable.\n" +
    "5. Low-priority missing terms should join the first grouped question only when they are concrete technologies and share an obvious likely insertion point with stronger missing terms. Skip low-priority fluff such as broad practices, generic domain language, or phrases like internet terminology.\n" +
    "6. On the first ask turn, ask all useful missing-technology questions together in one grouped message. Do not ask one technology per turn.\n" +
    "7. First-turn structure: put a short user-facing intro in assistantMessage. Use one compact inline list, such as: \"Not mentioned in your resume or USER.md: Go, Spark.\" Then say: \"Open any keyword below for a quick definition and two possible resume bullets. Do any of these match your experience? If so, which ones and where?\"\n" +
    "8. Do not put technology definitions or example bullets in assistantMessage. Put them in technologyContexts so the app can render compact collapsible cards. technologyContexts is available on any initiate_tailor_resume_probing_questions turn, including follow-up turns, whenever that turn is specifically asking about technology experience.\n" +
    "9. Each technologyContexts entry must contain the technology name, one sentence explaining what the technology is and which resume activities it most likely maps to, then different one-sentence example resume bullets or bullet fragments that include the exact keyword. Return exactly two examples by default. If the user explicitly asks for more examples, return the requested count for that technology, up to six examples. Examples must be ideal FAANG-level resume bullet suggestions: concise action + technical scope + positive result in the same sentence, preferably with a metric. Avoid generic low-signal examples like \"Used Spark for analytics\" or \"Built Cassandra tables\" unless the same sentence also explains the resulting scale, latency, cost, reliability, or product outcome. They do not need to be entirely new bullets: when an existing resume bullet is very closely adjacent, prefer showing a slight modification of that bullet that would truthfully add the missing skill. Do not label the explanation as \"Definition\" or \"One-sentence\", and do not label the bullets as \"Example A\", \"Example B\", or \"sample resume-add bullets\". If an example uses a dash suffix, the suffix must be the relevant resume company/project/experience name, not the technology name; for example, write `-- NewForm` or omit the suffix, never `-- Cassandra` on a Cassandra example.\n" +
    "10. Good technology definition style: \"Apache Spark helps you process large amounts of data by splitting it across computers in parallel; common for processing tons of logs, training ML models at scale.\" This is a good model for explaining what the tool is and helping the user recognize adjacent experience.\n" +
    "11. Good first-turn pattern:\n" +
    "\"assistantMessage\": \"Not mentioned in your resume or USER.md: Go, Spark.\\n\\nOpen any keyword below for a quick definition and two possible resume bullets. Do any of these match your experience? If so, which ones and where?\"\n" +
    "\"technologyContexts\": [{ \"name\": \"Cassandra\", \"definition\": \"Cassandra is a distributed NoSQL database used for high-write, large-scale time-series or event data; resume activities map to data modeling, migrations, or cluster tuning.\", \"examples\": [\"Migrated time-series data from MongoDB to Cassandra to reduce storage costs 40% and improve query tail latency by 2x.\", \"Redesigned Cassandra partition keys for ad-event ingestion to sustain 12k writes/sec while cutting hot-partition retries 35%.\"] }, { \"name\": \"Spark\", \"definition\": \"Apache Spark helps you process large amounts of data by splitting it across computers in parallel; common for processing logs, event streams, and training data at scale.\", \"examples\": [\"Wrote Spark streaming pipeline to aggregate event streams for real-time metrics at 10k msg/sec with exactly-once semantics.\", \"Optimized Spark ETL jobs with partition pruning to cut nightly feature-generation runtime 45% and unblock morning model refreshes.\"] }]\n" +
    "12. Keep the overall interview short. Usually one batched ask turn is enough; ask a follow-up only when the user's answer is ambiguous, contradicts itself, or asks for help.\n" +
    "13. If the latest user answer directly confirms experience with the technologies you asked about, treat that as enough context and call finish_tailor_resume_interview. Do not ask another placement, wording, or \"should I also insert these into bullets\" question. Never ask whether to add, replace, append, insert, or swap a bullet. Step 3 planning chooses skills versus existing bullets versus appended bullets from your USER.md notes.\n" +
    "14. Finish as soon as the missing detail is clear enough to improve the targeted resume blocks. Do not drag the chat out just to collect extra color.\n" +
    "15. When using initiate_tailor_resume_probing_questions, write compact question text in assistantMessage. The app visibly renders assistantMessage and the technologyContexts cards together, so do not repeat any technology definition or example bullet in assistantMessage or normal assistant text. On the first turn assistantMessage should list the grouped missing technologies and ask for matching experience; technology definitions and examples belong only in technologyContexts. On later turns, include technologyContexts again whenever you are asking about technology experience or providing technology-specific example bullets, including when the user asks for more examples; otherwise use an empty technologyContexts array.\n" +
    "16. Keep the question focused on missing technology evidence. Avoid throat-clearing like \"I have a few questions,\" \"this would strengthen the resume,\" or \"I'm trying to clarify\".\n" +
    "17. If the latest user message asks for examples, clarification, a draft, a review, or another direct reply before the next question, answer that request directly before asking the next question.\n" +
    "18. Keep the direct reply brief, adapt it to the user's new constraint or correction, and do not restate earlier framing unless it helps answer the request.\n" +
    "19. If you give technology bullet examples after the first turn, put them in technologyContexts rather than inline assistantMessage text. Give two examples by default, or the requested count when the user explicitly asks for more, up to six. Phrase them as possible answer shapes, not claims about what the user did. Do not repeat the same examples with light rewording when the user asked for different examples.\n" +
    "20. Do not make every assistant turn re-explain the full job-description rationale, resume-gap explanation, and answer examples. Once the context is already established, move the conversation forward.\n" +
    "21. Mention the exact job-description signal using a short quote when it materially helps the user understand why you are asking, and call out the resume gap plainly without implying the user is missing a requirement. Once that context is already established in the chat, avoid repeating it verbatim on later turns.\n" +
    "22. Prefer pointed yes/no-plus-context technology questions over broad open-ended questions. Ask in the user's language about adjacent projects, employers, or resume blocks.\n" +
    "23. Group missing technologies by likely resume insertion point when useful, but still give each technology its own name, one-sentence explanation, and example sentences in its own technologyContexts entry. Avoid every possible tool or practice in parentheses.\n" +
    "24. Keep the combined assistant turn highly skimmable: no essay paragraphs, no long preamble, and no more than two examples per skill unless the user explicitly asks for more.\n" +
    "25. Bad pattern: repeating the same job-description quote and the same answer examples after the user already asked for a more tailored variation.\n" +
    "26. learnings must be a compact working summary for the next model stage, not a transcript dump. Only include details grounded in the user's answers or directly restated from the accepted plan.\n" +
    "27. If an accepted plan is present, every learning.targetSegmentIds entry must reference only segmentIds from that plan. If Step 3 planning has not run yet or no target segment is certain, use an empty targetSegmentIds array and describe the likely experience/project in detail.\n" +
    "28. If the latest user answer asks you a question or asks for a sample/example/draft/review, do not finish the interview on that turn. For technology examples, answer with technologyContexts cards plus concise assistantMessage text; for other replies, answer in assistantMessage. Include one confirmation or correction question if more detail is still needed.\n" +
    "29. Call finish_tailor_resume_interview only when you believe the final compressed learnings are ready and you want the user to choose whether the chat should end. The app, not the tool call, gives the user the final Done button.\n" +
    "30. When calling finish_tailor_resume_interview, completionMessage should briefly say that you have enough context, that you are updating USER.md if edits are included, and that the user can keep chatting if they want to clarify anything else. Do not ask whether to add, replace, append, insert, or swap resume bullets. Do not add extra normal assistant text beyond that same concise completion.\n" +
    "31. If no questions are worth asking on the first turn, call skip_tailor_resume_interview instead of starting a chat.\n" +
    "32. Set debugDecision to \"not_applicable\" unless a debug override explicitly requires otherwise.\n\n" +
    "USER.md memory rules:\n" +
    "1. The current USER.md memory is provided in the input. Use it to avoid asking the user repetitive questions.\n" +
    "2. If USER.md already answers a planned edit's factual gap, include that fact in learnings with the relevant targetSegmentIds instead of asking again.\n" +
    "3. After each user answer, compare the full conversation against the current USER.md. If the latest answer added durable facts about experience, lack of experience, preferences, constraints, or reusable resume context that are not already in USER.md, include a USER.md patch on that turn even if you still need to ask one more question. Do not edit USER.md on the first ask turn before the user has answered.\n" +
    "4. Do not write facts to USER.md from the job description alone, from guesses, or from unsupported resume extrapolation.\n" +
    "5. Prefer append for ordinary new memory. Use exact-match operations only when deduplicating or restructuring existing USER.md content.\n" +
    "6. For each technology you asked about in the chat, write USER.md memory under a technology-specific heading. Under that heading, record one of: no user experience; can list in the skills section; or one or more quoted user-confirmed experience-evidence bullets that could support that technology, plus the skills-section category where the technology can be added.\n" +
    "7. Exact user-confirmed experience-evidence bullets must be wrapped in double quotes and end with `-- ExperienceName`, where ExperienceName is the employer, project, or organization the bullet belongs to. These quoted bullets are grounded context for Step 3 planning. They are not a Step 2 decision to add, replace, append, insert, or swap a resume bullet.\n" +
    "8. Non-exact notes must not be quoted. Use unquoted bullets for no-experience notes, skills-only permissions, adjacent exposure, uncertainty, or constraints. Do not make adjacency sound like production experience.\n" +
    "9. If the user confirms several technologies in one answer, write one USER.md bullet or technology section per confirmed technology. Do not collapse them into a generic storage, backend, frontend, or tooling note.\n" +
    "10. For confirmed missing technologies, prefer recording a skills-section category even when you also record experience-evidence bullets, so Step 3 has a direct place to consider the exact keyword. If you are unsure about resume placement but the user confirmed the technology, record that it can be listed in the skills section and finish.\n" +
    "11. Optimistically infer likely employer/project context from the resume, but only record confirmed user experience or confirmed non-experience. Do not ask the user to choose resume edit placement; Step 3 planning owns that decision.\n" +
    "12. When calling finish_tailor_resume_interview, include USER.md edit operations for every durable fact from the entire chat that is not already reflected in the current USER.md. Do not write only the latest user message if earlier answers in the same chat confirmed other technologies or constraints.\n",
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
    "8. If the desired text is an empty string, use an empty latexCode when removing that single planned bullet or line is clearly the right implementation. Do not leave an empty \\resumeitem{}, placeholder text, or a comment.\n" +
    "9. Prefer replacements whose visible text stays at or under the source block's character count when possible. Rewrite for higher signal instead of simply adding more words.\n" +
    "10. Small length increases are acceptable when they materially improve fit for the role, but bias strongly against cumulative growth because the resume should stay under one page.\n" +
    "11. Across all planned edits, avoid adding more than about 1-2 lines total unless that extra length is clearly necessary for a meaningfully better tailored resume.\n" +
    "12. If user-confirmed background learnings are provided, you may use them only in the targeted segments they reference. Do not spread them to unrelated blocks.\n" +
    "13. Treat user-confirmed background learnings as factual additions, but never invent beyond what the user explicitly confirmed.\n" +
    "14. Preserve factual and stylistic details that are outside the planned visible-text change. Do not change dates of experience, employers, titles, metrics, punctuation, separators, capitalization, or link text merely to polish the block.\n" +
    "15. Use the emphasized technology list as keyword guidance. Include exact technology names where they are already supported by the source resume, USER.md, user-confirmed learnings, or the accepted planned desired text, but never add unsupported tools just because the job asks for them.\n" +
    "16. If the accepted plan replaces a lower-signal bullet with user-confirmed technology experience, return that replacement as the single planned bullet. Do not move the technology only to skills and leave the planned experience bullet unchanged.\n\n" +
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
    "The current tailored preview is {{CURRENT_PAGE_COUNT}} {{CURRENT_PAGE_LABEL}}, and the renderer estimates that about {{ESTIMATED_LINE_REDUCTION}} {{ESTIMATED_LINE_REDUCTION_LABEL}} must be removed. " +
    "Make the smallest block-level cuts needed to get back within the limit while preserving the tailoring thesis. " +
    "Use the measurement tool as a scratchpad before your final submission: test candidate replacements there first, read the rendered-line result, and only move forward with candidates after that tool confirms a real line drop. " +
    "Then use the exact page-count verification tool on that same candidate set before you decide the pass is done, so you can read the actual rendered page count under the same final acceptance logic. " +
    "Only touch blocks where your proposed replacement is likely to remove at least one full rendered line versus the current saved version of that same block. Do not submit style-only, tone-only, wording-only, or same-line-count edits. " +
    "The measurement tool will reject any candidate whose rendered line count does not actually drop for that block, including candidates that merely shorten text while preserving the same number of rendered lines. " +
    "Prioritize blocks that currently render across multiple lines; treat already-one-line blocks as last-resort cuts unless deleting one is truly necessary. " +
    "If only one line needs to be reclaimed overall, strongly prefer one minimal verified line-saving change and leave the other edited blocks effectively the same. " +
    "If a verified candidate set still leaves the resume above the target page count, widen the next pass by adding another high-priority multi-line block rather than repeating the same small cut shape. " +
    "If the exact page-count verification still shows the resume above the target, you may still submit those verified line-saving candidates so the next pass starts from a smaller draft, but do not call the job done until the exact page-count verification is at or below the target. " +
    "For every returned block reason, remember that it fully replaces the old reason shown to the user. Lead with what changed in the context of the job description, such as the technology, responsibility, metric, or outcome being emphasized. Mention the need to shorten only as a passing sentence fragment, and never lead with claims like shortened, tightened, removed filler, or reclaimed space.",
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
      nextSettings[key] =
        key === "jobApplicationExtraction"
          ? ensureJobApplicationExtractionPromptRules(candidateValue)
          : candidateValue;
    }
  }

  return nextSettings;
}

export function buildJobApplicationExtractionSystemPrompt(
  settings: SystemPromptSettings,
) {
  return ensureJobApplicationExtractionPromptRules(
    settings.jobApplicationExtraction,
  );
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
  const prompt = renderSystemPromptTemplate(settings.tailorResumePlanning, {
    FEEDBACK_BLOCK: buildFeedbackBlock(
      "Previous attempt feedback",
      input.feedback,
    ),
  }).trim();

  return [
    prompt,
    buildTailorResumePlanningTechnologyContextBlock(),
    buildTailorResumePlanningOutputContractBlock(),
  ].join("\n\n").trim();
}

export function buildTailorResumeImplementationSystemPrompt(
  settings: SystemPromptSettings,
  input: { feedback?: string },
) {
  const prompt = renderSystemPromptTemplate(settings.tailorResumeImplementation, {
    FEEDBACK_BLOCK: buildFeedbackBlock(
      "Previous implementation feedback",
      input.feedback,
    ),
  }).trim();

  return `${prompt}\n\n${buildTailorResumeImplementationTechnologyContextBlock()}`.trim();
}

export function buildTailorResumeInterviewSystemPrompt(
  settings: SystemPromptSettings,
  input: {
    debugForceConversation?: boolean;
    feedback?: string;
  },
) {
  const prompt = renderSystemPromptTemplate(settings.tailorResumeInterview, {
    DEBUG_FORCE_BLOCK: buildTailorResumeInterviewDebugBlock({
      debugForceConversation: input.debugForceConversation === true,
    }),
    FEEDBACK_BLOCK: buildFeedbackBlock(
      "Previous interview feedback",
      input.feedback,
    ),
  }).trim();

  return [
    prompt,
    buildTailorResumeInterviewUserMarkdownMemoryBlock(),
    buildTailorResumeInterviewTechnologyContextBlock(),
    buildTailorResumeInterviewToolContractBlock(),
  ].join("\n\n").trim();
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
    estimatedLineReduction?: number;
    targetPageCount: number;
  },
) {
  const normalizedCurrentPageCount = Math.max(1, Math.floor(input.currentPageCount));
  const normalizedEstimatedLineReduction = Math.max(
    1,
    Math.floor(input.estimatedLineReduction ?? 1),
  );
  const normalizedTargetPageCount = Math.max(1, Math.floor(input.targetPageCount));

  return renderSystemPromptTemplate(settings.tailorResumePageCountCompaction, {
    CURRENT_PAGE_COUNT: String(normalizedCurrentPageCount),
    CURRENT_PAGE_LABEL: normalizedCurrentPageCount === 1 ? "page" : "pages",
    ESTIMATED_LINE_REDUCTION: String(normalizedEstimatedLineReduction),
    ESTIMATED_LINE_REDUCTION_LABEL:
      normalizedEstimatedLineReduction === 1 ? "rendered line" : "rendered lines",
    TARGET_PAGE_COUNT: String(normalizedTargetPageCount),
    TARGET_PAGE_COUNT_HARD_REQUIREMENT: buildPageCountHardRequirement(
      normalizedTargetPageCount,
    ),
    TARGET_PAGE_COUNT_REQUIREMENT: buildPageCountRequirement(
      normalizedTargetPageCount,
    ),
  }).trim();
}
