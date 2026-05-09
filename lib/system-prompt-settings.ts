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
    "- DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE is enabled for this run.\n" +
    "- On the first interview turn, you must ask at least one follow-up question. Do not call skip_tailor_resume_interview or finish_tailor_resume_interview on that first turn.\n" +
    "- The app records that the question was debug-forced outside the tool arguments; do not add debug-only fields to any interview tool.\n\n"
  );
}

function buildTailorResumeInterviewToolContractBlock() {
  return (
    "Current interview tool contract:\n" +
    "- Call exactly one interview tool on every turn.\n" +
    "- The tool call is the control-plane output and its assistantMessage or completionMessage is rendered visibly in the chat UI, so do not reiterate things you put there.\n" +
    "- initiate_tailor_resume_probing_questions is presentation-only. Put the concise question text in assistantMessage. Do not include USER.md edits, learnings, keyword decisions, non-technology terms, or debug fields in this tool.\n" +
    "- finish_tailor_resume_interview is the only tool that writes USER.md. Put a short status in completionMessage, compact final learnings in learnings, and all durable memory updates in userMarkdownEditOperations. The app will immediately save the memory updates and continue tailoring; do not ask the user to confirm, press Done, or keep chatting before the tool can finish. Never ask permission to update USER.md after the user answers; updating USER.md is the point of this chat.\n" +
    "- Use initiate_tailor_resume_probing_questions to keep the chat open. On the first ask turn, ask all useful technology questions together in one grouped message instead of opening a multi-turn checklist.\n" +
    "- If the latest user answer asks for a sample, draft, clarification, or review, keep the chat open with initiate_tailor_resume_probing_questions only when that reply is still needed to capture accurate memory. Keep assistantMessage concise. If the user also asks to end or proceed, save the durable facts and finish. Do not ask whether to add, replace, append, insert, or swap resume bullets; that placement decision belongs to Step 3 planning.\n" +
    "- Use finish_tailor_resume_interview after an interview has already started as soon as the latest user answer gives enough durable context, or whenever the user asks to end, finish, wrap up, proceed, or start tailoring. The tool call ends the chat and starts the remaining tailoring steps immediately.\n" +
    "- If the user gives quoted bullet text and names the employer, project, section, or skills-only constraint after the quote with phrasing like \"in Johns Hopkins\", \"for N-body\", \"under Kubernetes too\", or \"skills only\", treat that as an explicit mapping. Save it to USER.md and finish; do not ask whether to add the confirmed bullets or where they should go.\n" +
    "- update_tailor_resume_non_technologies is the only tool that removes rejected keywords or updates the durable non-technology deny-list. Use it when the latest user answer says scraped terms are not real technologies, not real skills, nonsense, or should not be included. Put every rejected emphasized keyword in nonTechnologyTerms, set matching keywordDecisions entries to action \"remove\", and say that you are updating the non-technology list.\n" +
    "- skip_tailor_resume_interview takes only a reason and is allowed only on the first turn when no interview should start at all. Do not write assistant text or mutations for skip.\n" +
    "- If the user answer added durable facts but one more concrete follow-up is genuinely required, ask the follow-up with initiate_tailor_resume_probing_questions and then write all durable facts from the chat when you later call finish_tailor_resume_interview.\n" +
    "- If userMarkdownEditOperations is non-empty, do not ask for a separate confirmation to save them. Save the durable facts now with finish_tailor_resume_interview.\n" +
    "- USER.md edit operations are transactional markdown patches. Supported op values are append, replace_exact, insert_before, insert_after, and delete_exact.\n" +
    "- For append, set headingPath to the section path you want and markdown to the exact markdown to add. The app will create missing headings. Leave oldMarkdown, newMarkdown, and anchorMarkdown empty strings.\n" +
    "- For replace_exact, set oldMarkdown and newMarkdown. For insert_before/insert_after, set anchorMarkdown and markdown. For delete_exact, set markdown. Prefer append unless you are certain the exact anchor text is present; patch misses are not a reason to invalidate the Step 2 chat response.\n" +
    "- keywordDecisions lives on update_tailor_resume_non_technologies and is the deterministic place to remove emphasized keywords after the user rejects them. Use action \"remove\" only when the user explicitly says a keyword is not a real requirement keyword, is nonsense, or should not count for this role.\n" +
    "- nonTechnologyTerms is a durable case-insensitive deny-list for future Step 1 keyword scraping. It is structured user memory stored alongside USER.md, not inside USER.md. The app displays those names as inline badges with a capital first letter, but you should pass only the exact rejected keyword names from the current emphasized list.\n" +
    "- Never put placeholders such as \"... rest unchanged\" or \"[existing content]\" inside USER.md edit fields.\n"
  );
}

function buildTailorResumePlanningOutputContractBlock() {
  return (
    "Current planning output contract:\n" +
    "- Return emphasizedTechnologies as an array, even when it is empty.\n" +
    "- Each emphasizedTechnologies item must include name, priority, and evidence.\n" +
    "- priority must be exactly high or low.\n" +
    "- Use emphasizedTechnologies only for resume-searchable skills a realistic candidate could add to a resume Skills or Technical Skills section: concrete technologies, programming languages, named frameworks, named libraries, databases, infrastructure tools, developer tools, and named technical methods.\n" +
    "- Do not extract general domains, responsibilities, processes, or environment descriptions that are not concrete skills. For example, never return Production Infrastructure or Production clusters.\n" +
    "- Shorten compound job phrases to the core resume skill. For example, return Kubernetes for Kubernetes-based PaaS, not Kubernetes-based PaaS.\n" +
    "- Do not extract company-specific internal products, product suites, platform names, customer-facing product brands, team names, mission names, or nouns that only describe what the company builds. Skip employer-branded terms unless the posting explicitly asks candidates to have prior experience using that product.\n" +
    "- Infer priority from the posting: high for required/basic/minimum terms, repeated terms, title/team-defining terms, and strongly emphasized preferred terms; low for weaker preferred, nice-to-have, incidental, or broad ecosystem terms.\n" +
    "- Return one atomic technology per item. Hard rule: if a slash, comma, parenthetical, or grouped phrase separates two distinct technologies, you must return separate emphasizedTechnologies items for each named technology, such as TypeScript and JavaScript instead of TypeScript/JavaScript, and React and Next.js instead of React / Next.js.\n" +
    "- Do not replace named skills with broad group labels when the posting names specific technologies; include the specific names.\n" +
    "- Prefer the core technology term and remove interchangeable vendor or marketing fluff when the inner term is what people actually list on resumes. For example, return Visual Studio instead of Microsoft Visual Studio. We need the smaller stable term so deterministic string matching can find it in resumes.\n" +
    "- Do not return workflow nouns, UI/product feature labels, roadmap terms, or generic system categories such as commit previews, blueprints, storage systems, frontend frameworks, developer experience, internationalization, or internet terminology unless the posting explicitly frames that exact phrase as a candidate skill and no named concrete technology is present.\n" +
    "- Do not return browser/project names such as Chromium merely because the employer builds on or for them; include them only when the posting asks for candidate experience with that technology.\n" +
    "- Do not return section-label fields. Keep section/source context only in evidence.\n"
  );
}

function buildTailorResumePlanningToolContractBlock() {
  return (
    "Available tools:\n" +
    "- check_planned_resume_keyword_coverage is required before final JSON. Call it with your current plan as { changes: [{ segmentId, desiredPlainText }] }.\n" +
    "- The tool applies those plaintext replacements to the full resume and reports high- and low-priority keyword coverage.\n" +
    "- If supported high-priority terms are missing, revise the plan and call the tool again. Return final JSON only after coverage is acceptable or the remaining misses are intentionally unsupported.\n"
  );
}

function buildTailorResumeInterviewTechnologyContextBlock() {
  return (
    "Current emphasized-technology context:\n" +
    "The input includes deterministic keyword presence for the original resume and USER.md. Use that model-only context as the main Step 2 clarification decision anchor after Step 1 keyword scraping and before Step 3 planning runs. It is okay to tell the user that a skill was not found in the resume or USER.md, but do not expose raw analysis fields. Strongly prefer asking when a concrete job technology is missing from both the original resume and USER.md and you cannot cleanly assume the user's experience yourself. Skip questions for vague, generic, or low-value terms such as broad practices, collaboration traits, or phrases like internet terminology. Include low-priority missing terms in the grouped question only when they are concrete and share an obvious likely insertion point with stronger terms. Group ask-worthy missing technologies into one pointed direct question, such as \"Do you have experience with Go, Cassandra, or Spark? If so, where did you use them and what was the impact?\" Do not generate structured examples, technology definitions, or card payloads for the UI.\n"
  );
}

function buildTailorResumeInterviewUserMarkdownMemoryBlock() {
  return (
    "Current USER.md technology-memory format:\n" +
    "- When finish_tailor_resume_interview writes USER.md, organize technology learnings under technology-specific headings such as \"## Cassandra\" or \"## Spark\" unless the current USER.md already has a clearly equivalent section.\n" +
    "- Under each technology heading, write separate markdown bullets. End bullets that map to a specific employer/project/experience with `-- ExperienceName`, for example `-- KnoWhiz` or `-- NewForm`.\n" +
    "- Quoted bullets are user-confirmed experience evidence written in resume-bullet shape. Put the entire candidate bullet text in double quotes, then add `-- ExperienceName`. They are durable USER.md context for Step 3 planning, not instructions to add, replace, append, insert, or swap a resume bullet in Step 2.\n" +
    "- Do not turn uncertain or adjacent experience into a quoted production-style claim. If the user only confirmed adjacency, familiarity, or that the technology can be listed in skills, write an unquoted factual note instead.\n" +
    "- Unquoted bullets are factual notes or constraints, not exact candidate resume wording. Use them for no-experience notes, skills-only permissions, adjacent exposure, uncertainty, or constraints such as `No direct production Cassandra experience.` or `Can list Gradle in build tools skills; used adjacent Java build automation, but did not confirm Gradle project work.`\n" +
    "- For each technology asked about in the chat, record one of: no user experience; can list in the skills section; or one or more quoted user-confirmed experience-evidence bullets tied to the relevant employer/project/experience. Include the skills-section category when the technology can be added there. Step 3 planning decides whether that memory should become a skills entry, a replacement bullet, an appended bullet, or no resume edit.\n" +
    "- Preserve the distinction between direct experience and adjacency. Never write `production`, scale metrics, ownership, or exact technologies into a quoted bullet unless the user confirmed those details.\n" +
    "- When the user provides a quote followed by `in`, `for`, `under`, or a skills-only constraint, preserve that mapping literally in USER.md. For example, `Use \"...Grafana...\" in Johns Hopkins` becomes a Grafana quoted bullet ending `-- Johns Hopkins`; `add that under Kubernetes too` becomes an additional Kubernetes note or quoted bullet with the same confirmed project mapping.\n"
  );
}

function buildTailorResumeImplementationTechnologyContextBlock() {
  return (
    "Current emphasized-technology context:\n" +
    "The input includes technologies emphasized by the job description with high/low priority. Include high-priority exact technology keywords wherever they are already supported by the resume, USER.md, user-confirmed interview learnings, or the accepted planned desired text. Use low-priority terms only when they fit naturally. Do not invent unsupported technology experience, and do not edit unplanned blocks.\n\n" +
    "USER.md technology-memory semantics:\n" +
    "Quoted bullets under technology headings are user-confirmed experience evidence tied to the experience after `-- ExperienceName`; treat them as grounded starting points that Step 3 planning may adapt into skills entries or block edits. They are not placement instructions by themselves. If the accepted plan uses a quoted USER.md bullet as experience evidence, implement that planned block edit as an actual experience-bullet replacement rather than downgrading it to a skills-only keyword. If the accepted plan includes a skills-section change, preserve only the planned entries that are actual skills: concrete tools, languages, frameworks, databases, infrastructure tools, developer tools, or named methods already supported by the source resume or by a dedicated USER.md sentence/bullet for that exact technology. If the accepted plan uses a concrete actual skill in a non-skills bullet and also edits a Skills or Technical Skills segment, the same exact skill should appear in that Skills segment; bullet keyword coverage is not a substitute for skills-list coverage. Do not add capability phrases to Skills merely for keyword peppering, such as RESTful, RESTful APIs, cloud infrastructure, or data structures, unless USER.md explicitly says that exact phrase can be listed as a skill. Unquoted bullets are factual notes, constraints, skills-only permissions, adjacency notes, or no-experience statements; do not turn them into exact resume claims unless the note explicitly supports that claim.\n\n" +
    "Quote fidelity is mandatory. When the planned desiredPlainText for an experience bullet introduces a technology that has one or more quoted candidate bullets in USER.md under that technology's heading, the implemented latex must stay faithful to the wording of the matching quoted bullet (the one whose `-- ExperienceName` matches the targeted segment). You may make minimal adjustments only: light tightening for length, fixing tense or pronouns, swapping a single near-synonym for fit, escaping LaTeX special characters, or trimming a clause. Do not paraphrase aggressively, do not invent new metrics, scope, scale, or outcomes that do not appear in the quoted bullet, and do not write a fabricated alternative bullet on the grounds that it sounds stronger. If the planned text already conflicts with every available quoted bullet for that technology and experience, fall back to the quoted wording rather than amplifying the fabricated planned text.\n"
  );
}

function buildTailorResumeImplementationUserMarkdownFormattingBlock() {
  return (
    "USER.md-to-LaTeX formatting:\n" +
    "USER.md is Markdown, not LaTeX. When an implemented non-skills block uses a USER.md sentence or quoted candidate bullet as the source for visible resume text, translate any Markdown bold emphasis (`**word**` or `**short phrase**`) into LaTeX `\\textbf{word}` and remove the Markdown markers. If USER.md does not explicitly bold anything but the copied or adapted sentence supports one or two specific job-emphasized technologies or capabilities, bold only those exact one or two words or short phrases with `\\textbf{...}`. Do not bold the entire sentence, do not bold generic verbs or filler, do not add bolding to unrelated source-resume text, and never add inline bolding inside Skills or Technical Skills sections.\n"
  );
}

function buildTailorResumeImplementationToolContractBlock() {
  return (
    "Available tools:\n" +
    "- check_implemented_resume_keyword_coverage is required before final JSON. Call it with your current implementation as { changes: [{ segmentId, latexCode }], lineCountSegmentIds: [] }.\n" +
    "- The tool applies those LaTeX replacements to the full resume and reports keyword coverage, rendered page count, malformed rendered bullets, and any requested segment line counts.\n" +
    "- Pass lineCountSegmentIds as [] unless exact rendered line counts for specific segmentIds would help you revise. If the tool reports a missing supported high-priority keyword or a changed malformed bullet, revise and call it again. Return final JSON only after coverage and changed-bullet health are acceptable.\n"
  );
}

function buildTailorResumePlanningTechnologyContextBlock() {
  return (
    "Current USER.md and Step 2 technology-learning semantics:\n" +
    "- Quoted bullets under technology-specific USER.md headings are user-confirmed experience evidence tied to the employer, project, or experience named after `-- ExperienceName`. Treat those quoted bullets as strong grounded candidates for experience-bullet edits when the job description emphasizes that technology.\n" +
    "- Do not satisfy a user-confirmed technology only by adding it to the skills section when USER.md also provides a quoted candidate experience bullet for that technology. Prefer an experience-bullet replacement or swap in the matching employer/project/experience, and include the exact keyword in the skills section when it passes the skills-entry gate below. If you plan a non-skills bullet that uses a concrete technology, framework, language, database, infrastructure tool, observability tool, developer tool, or named method, and an editable Skills or Technical Skills block exists, also plan the Skills edit for that same exact keyword; bullet keyword coverage alone is not enough for actual skills.\n" +
    "- Quote fidelity is mandatory. When USER.md provides one or more quoted candidate bullets for a technology you are introducing into an experience bullet, desiredPlainText MUST be derived from one of those quoted bullets. Pick the quoted bullet whose `-- ExperienceName` matches the targeted segment's employer/project/experience, and copy its wording with only minimal edits (light tightening for length, fixing tense or pronouns, swapping a single near-synonym for fit, or trimming a clause). Do not paraphrase aggressively, do not invent new metrics or scope, and do not fabricate an alternative bullet that says something the quoted bullet did not say. If you are tempted to write phrasing that does not appear in any quoted bullet, you are fabricating; stop and use the quoted text instead.\n" +
    "- If multiple quoted bullets exist for the same technology and target experience, pick the single best fit for the job description and adapt only that one. Do not blend phrases from several quoted bullets into a new claim.\n" +
    "- If no quoted bullet exists for the targeted experience but only an unquoted note (skills-only permission, adjacency, no-experience), do not write a fabricated production-style bullet. Either add the keyword to the skills section if it passes the skills-entry gate, target a different experience that does have a quoted bullet, or skip the bullet edit entirely.\n" +
    "- Skills-entry gate: the Skills or Technical Skills section is for actual skills, not for every keyword used to pepper the resume. Add a new skills-list entry only when it is a concrete tool, language, framework, database, infrastructure tool, developer tool, or named method, and either the source resume already supports it as a real skill or USER.md has a dedicated sentence/bullet for that exact technology saying it can be listed in skills, describing direct experience/exposure, or providing quoted experience evidence. When a concrete actual skill passes this gate and you use it in an experience/project bullet, include it in Skills too when an editable Skills block exists. Do not add capability phrases merely for ATS coverage, such as RESTful, RESTful APIs, cloud infrastructure, data structures, production infrastructure, or similar wording, unless USER.md explicitly says that exact phrase can be listed as a skill. Those terms may still appear naturally in experience bullets or keyword coverage checks.\n" +
    "- Some concrete technologies are skills-only: if USER.md has a dedicated note that a tool such as Windsurf can be listed in a skills category, add it to Skills when relevant, but do not force an experience bullet just to mention it.\n" +
    "- The implementation stage is segment-safe and normally replaces one existing block at a time. To add a new bullet-shaped experience from USER.md, plan it as a swap: choose the weakest or least job-relevant existing bullet in the same experience and set desiredPlainText to the adapted quoted USER.md bullet (per rule 3). Do not ask Step 4 to invent a brand-new neighboring bullet outside the targeted segment.\n" +
    "- If an existing bullet is low-value for this role and should simply disappear, you may plan deletion by setting desiredPlainText to an empty string for that single bullet segment. Use this only for an entire bullet/line segment, not for structural wrappers.\n" +
    "- Unquoted USER.md notes are constraints, skills-only permissions, adjacency notes, or no-experience statements. Use them conservatively; do not convert adjacency or skills-only permission into an experience bullet unless the note explicitly supports that claim.\n"
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
    "- Header: match the centered header structure from the reference example, including how the name is centered and how the contact lines are centered beneath it.\n" +
    "- Education section: match the alignment pattern in the reference example, especially the left/right tabular alignment for school and dates, plus the indented follow-up lines below it.\n" +
    "- Technical skills section: do not align the text like the education section. Follow the reference example where each skills line continues naturally after the colon using the hanging-indent style rather than trying to force tabular left/right alignment.\n" +
    "- Bolding: pay special attention to what is visibly bolded in the uploaded image and reproduce that emphasis faithfully in LaTeX. Do not flatten bold emphasis, and do not assume only headings are bold; important phrases inside bullets, links, labels, names, and other inline fragments may need \\textbf{} as shown by the source image.\n" +
    "- Vertical spacing: pay close attention to the tight vertical spacing in the source image and the reference example. Use small spacing adjustments, including negative \\vspace{...} values when appropriate, to pull sections closer together and match the visual density of the original resume, especially between the centered header and the first section and around section transitions. Avoid leaving the document with loose default spacing when the source image is visibly tighter.\n" +
    "- Unicode safety: do not emit unsupported raw Unicode glyphs such as replacement characters or private-use characters. Replace them with LaTeX-safe ASCII or explicit LaTeX commands.\n" +
    "- Link fidelity: only preserve hyperlink styling when the destination is explicitly supported by the visible resume content, saved known links, or embedded PDF link metadata. If a destination fails validation or the visible text does not support a specific target, keep the visible text but remove \\href and link-only styling such as \\tightul instead of guessing a replacement.\n" +
    "- Deleted links: if saved context says a label should remain plain text, do not recreate a hyperlink for it even if the label looks like a valid URL.\n" +
    "- Special character escaping: in plain text content, the characters }, {, #, %, &, $, _, ^, ~, and \\ are special in LaTeX and must be escaped (e.g., \\}, \\{, \\#, \\%, \\&, \\$, \\_, \\^{}, \\~{}, \\textbackslash{}). A bare } or { in text content is the most common cause of 'Extra }' or 'Missing $' compile errors. Only leave these unescaped inside LaTeX command arguments where they serve a structural role (e.g., \\textbf{...}, \\href{...}{...}).\n\n" +
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
    "- Work from the provided whole-resume plaintext and block plaintext. Do not write LaTeX.\n" +
    "- Each planned change must target one segmentId from the provided block list.\n" +
    "- desiredPlainText must be the intended final visible text for that single block only, with no LaTeX commands or segment markers.\n" +
    "- Keep the desired text faithful to the targeted block's scope. If a rewrite should affect multiple blocks, return multiple change objects.\n" +
    "- Do not reference structural blocks that were omitted from the plaintext block list.\n" +
    "- Never reference the same segmentId more than once.\n" +
    "- Every change must include a concise reason string that explains why the edit improves fit for this specific job description.\n" +
    "- When USER.md contains quoted experience evidence for a job-emphasized technology, strongly consider targeting the matching experience bullet instead of only editing the technical skills section.\n" +
    "- Because implementation is block-scoped, plan new bullet-shaped evidence as a replacement/swap for an existing lower-signal bullet in the same experience whenever possible. Use an empty desiredPlainText only when deleting one whole bullet or line is the intended edit.\n" +
    "- Your primary goal is to make sure the final planned resume text includes every remaining high-priority keyword that is already supported by the original resume, USER.md, or Step 2 user-confirmed learnings. Make any additional improvements after that coverage obligation is satisfied.\n" +
    "- When editing Skills or Technical Skills, add only actual skills. A new skills entry must be a concrete tool, language, framework, database, infrastructure tool, developer tool, or named method, and it must either already be supported as a real skill by the source resume or have a dedicated USER.md sentence/bullet for that exact technology saying it can be listed in skills, describing direct experience/exposure, or providing quoted experience evidence. If any planned non-skills bullet uses a concrete actual skill that passes this gate and a Skills or Technical Skills block is editable, return a Skills change in the same plan that lists that exact skill in the closest existing category. Do not rely on the bullet alone to cover the Skills section. Do not add peppering/capability phrases such as RESTful, RESTful APIs, cloud infrastructure, data structures, production infrastructure, or similar wording to Skills merely because the job description emphasized them; use those in bullets or coverage checks when they fit naturally. Skills-only concrete tools like Windsurf are valid Skills additions when USER.md has a dedicated note permitting them, even if they are not worthy of an experience bullet.\n" +
    "- Follow the Available tools section before final JSON. Use low-priority terms when they fit truthfully and naturally, but do not let them crowd out the high-priority coverage goal.\n\n" +
    "Metadata rules:\n" +
    "- companyName should be the employer if identifiable.\n" +
    "- positionTitle should be the role title if identifiable.\n" +
    "- displayName should be the user-facing saved name, preferably \"Company - Role\".\n\n" +
    "Thesis rules:\n" +
    "- Return thesis.jobDescriptionFocus and thesis.resumeChanges.\n" +
    "- thesis.jobDescriptionFocus should explain what this job description emphasized beyond common denominator requirements like having a bachelor's degree, being a software engineer, or other baseline expectations. Strip out the generic signals and name the specific areas where this posting clearly over-indexes.\n" +
    "- thesis.jobDescriptionFocus should focus on 2-4 high-signal themes and can quote short exact phrases from the job description when helpful.\n" +
    "- thesis.resumeChanges should summarize the broad ways the resume should be or was changed to match those themes, such as which experience was elevated, compressed, reframed, or made more explicit.\n" +
    "- thesis.resumeChanges should stay at the strategy level, not a line-by-line diff.\n" +
    "- Keep each thesis field concise and high signal, ideally 2-4 sentences.\n\n" +
    "Technology emphasis rules:\n" +
    "- Return emphasizedTechnologies as a deduped list of resume-searchable skills the job description emphasizes. Include only terms a realistic candidate could add to a resume Skills or Technical Skills section: concrete technologies, programming languages, named frameworks, named libraries, databases, infrastructure tools, developer tools, and named technical methods.\n" +
    "- Pay special attention to sections labeled required, basic, minimum, preferred, nice-to-have, or similar when extracting the list. Include every resume-searchable technology named in required/basic/minimum sections, not just a representative subset.\n" +
    "- Do not include every incidental tool from navigation, boilerplate, benefits, equal-opportunity text, or unrelated roles on the scraped page.\n" +
    "- Do not extract company-specific internal products, product suites, platform names, customer-facing product brands, team names, mission names, product capabilities, workflow nouns, UI labels, general domains, responsibilities, processes, environment descriptions, or nouns that only describe what the company builds. Skip employer-branded terms unless the posting explicitly asks candidates to have prior experience using that product. A term should survive only if a realistic candidate could add it to their resume skills section.\n" +
    "- Never return Production Infrastructure or Production clusters. Shorten compound job phrases to the core resume skill: return Kubernetes for Kubernetes-based PaaS, not Kubernetes-based PaaS.\n" +
    "- Preserve exact core technology names and capitalization when possible.\n" +
    "- Mark priority high for required/basic/minimum technologies, repeated technologies, title/team-defining technologies, and unusually strong preferred signals. Mark priority low for weaker preferred, nice-to-have, incidental, or broad ecosystem terms.\n" +
    "- Return one atomic technology per item. Hard rule: if a slash, comma, parenthetical, or grouped phrase separates distinct technologies, you must return separate emphasizedTechnologies items for each named technology, such as TypeScript and JavaScript instead of TypeScript/JavaScript, React and Next.js instead of React / Next.js, and Python, Java, C++ as three items. Do not use a broad wrapper label such as front-end frameworks when the posting names specific frameworks.\n" +
    "- Prefer the core technology term and remove interchangeable vendor or marketing fluff when the inner term is what people actually list on resumes. For example, return Visual Studio instead of Microsoft Visual Studio. We need the smaller stable term so deterministic string matching can find it in resumes.\n" +
    "- Do not return broad group labels or generic categories such as frontend frameworks, storage systems, platform, infrastructure, developer experience, production infrastructure, production clusters, commit previews, blueprints, internationalization, or internet terminology when they are product/domain language rather than named candidate skills.\n" +
    "- Do not return browser/project names such as Chromium merely because the employer builds on or for them; include them only when the posting asks for candidate experience with that technology.\n" +
    "- When choosing planned changes, include high-priority technology keywords when the resume, USER.md, Step 2 user-confirmed learnings, or existing block text already supports them. Do not invent unconfirmed technology experience.\n" +
    "- The high-priority list you receive after Step 2 should already have bad keywords removed and should already be accounted for in either the original resume or USER.md. Your job in Step 3 is to move those grounded keywords into the tailored resume text itself.\n" +
    "- For extracted technology keywords, distinguish Skills entries from bullet-only keyword coverage. Concrete technologies with dedicated source-resume or USER.md support may go into Skills under the closest existing category; capability phrases used to pepper fit, such as RESTful or cloud infrastructure, should not be added to Skills unless USER.md explicitly records them as skills-list entries.\n\n" +
    "Reason rules:\n" +
    "- Keep every reason to 1-2 short sentences maximum.\n" +
    "- Sentence 1 should briefly summarize the high-level change you made and name the concrete thing that changed, using the employer, project, feature, accomplishment, metric, or technology anchor from that resume block when possible.\n" +
    "- Do not write vague sentence-1 summaries like \"Reframes the accomplishment to...\" or \"Highlights relevant experience\" with no subject. Make sentence 1 understandable on its own without opening the diff.\n" +
    "- Sentence 2 should explain why that change matters for this role, preferably by quoting a short exact phrase from the job description in quotation marks.\n" +
    "- If the pasted job description makes the section clear, explicitly say whether that quote came from a required/basic qualification, a preferred/good-to-have qualification, responsibilities, or another labeled section.\n" +
    "- Do not guess section labels. If the pasted text does not clearly identify the section, just give the quote without inventing where it came from.\n" +
    "- When the job description explicitly emphasizes something, quote those exact words instead of vaguely saying it was emphasized or mentioned in the description.\n" +
    "- If no short exact quote fits naturally, use the closest brief phrase from the job description, but still avoid generic wording like \"matches the job description\" with no supporting detail.\n" +
    "- Prefer concise fragments or incomplete sentences over polished prose.\n" +
    "- NEVER under any circumstances write 3 sentences for a single block edit.\n" +
    "- Good examples: \"Reframes NewForm TikTok refactor accomplishment around developer experience. Responsibilities mention \\\"developer experience\\\".\" and \"Surfaces GitHub OSS work earlier. Required qualifications mention \\\"GitHub-hosted open-source projects\\\".\"\n" +
    "- Bad examples: \"Reframes the accomplishment to highlight developer experience.\" and \"Matches the required section\" with no quote.\n" +
    "- Focus on the job-description signal you matched, not on generic writing advice.\n\n" +
    "Job description source quality:\n" +
    "The job description below may be scraped from a job board page and can include navigation chrome, sidebar links, footer text, and listings for other roles. Identify and focus only on the single target job posting. Ignore unrelated job listings, site navigation, and boilerplate page text.\n\n" +
    "Guardrails:\n" +
    "- Preserve factual accuracy. Never invent achievements, employers, dates, titles, technologies, metrics, degrees, or certifications.\n" +
    "- It is heavily discouraged to plan styling, page layout, margins, font sizing, spacing systems, or macro-structure changes unless the job fit clearly depends on them.\n",
  tailorResumeInterview:
    "{{FEEDBACK_BLOCK}}{{DEBUG_FORCE_BLOCK}}Decide whether the user should be asked a few follow-up questions before the tailored resume is planned and implemented in LaTeX. Step 2 exists only to gather reusable context and update USER.md about what experience the user has.\n\n" +
    "Use the available interview tools instead of returning plain JSON.\n\n" +
    "Questioning rules:\n" +
    "- Asking the user is optional, but do not make the threshold so high that important job technologies stay missing. Default to asking when the deterministic keyword context says a concrete technology is missing from both the original resume and USER.md and you cannot cleanly assume the user's experience yourself.\n" +
    "- Only ask when the keyword cannot already be found in the resume or USER.md.\n" +
    "- On the first ask turn, ask all useful missing-technology questions together in one grouped message. Do not ask one technology per turn.\n" +
    "- Ask direct questions in assistantMessage only.\n" +
    "- As soon as you gather all context needed, call finish_tailor_resume_interview tool. There is no need to confirm this with the user over text — as soon as the tool is invoked, they will see a modal that they can accept to end the chat. Do not waste the user's time asking permissions to edit user.md or ending the chat. \n" +
    "- Be concise. Avoid throat-clearing like \"I have a few questions,\" \"this would strengthen the resume,\" or \"I'm trying to clarify\".\n" +
    "- When finishing, learnings must be a compact working summary for the next model stage, not a transcript dump. Only include details grounded in the user's answers or directly restated from the accepted plan.\n" +
    "- If an accepted plan is present, every learning.targetSegmentIds entry must reference only segmentIds from that plan. If Step 3 planning has not run yet or no target segment is certain, use an empty targetSegmentIds array and describe the likely experience/project in detail.\n" +
    "- Step 2 records confirmed support and explicit rejections; it does not need to prove every job keyword is usable before finishing. If a high-priority keyword is still unsupported after the user's answer, leave it unsupported so Step 3 does not invent experience.\n" +
    "- If no questions are worth asking on the first turn, call skip_tailor_resume_interview instead of starting a chat.\n" +
    "USER.md memory rules:\n" +
    "- The current USER.md memory is provided in the input. USER.md was compiled from previous chats just like this one, so do not ask a question if you can get the answer from USER.md.\n" +
    "- No need to ask the user's permission to edit USER.md. The assumption is that you do this automatically.\n" +
    "- Prefer append for ordinary new memory. Use exact-match operations only when deduplicating or restructuring existing USER.md content.\n" +
    "- For each technology you asked about in the chat, write USER.md memory under a technology-specific heading. Under that heading, record one of: no user experience; can list in the skills section; or one or more quoted user-confirmed experience-evidence bullets that could support that technology, plus the skills-section category where the technology can be added.\n" +
    "- Exact user-confirmed experience-evidence bullets must be wrapped in double quotes and end with `-- ExperienceName`, where ExperienceName is the employer, project, or organization the bullet belongs to. These quoted bullets are grounded context for Step 3 planning. They are not a Step 2 decision to add, replace, append, insert, or swap a resume bullet.\n" +
    "- Non-exact notes must not be quoted. Use unquoted bullets for no-experience notes, skills-only permissions, adjacent exposure, uncertainty, or constraints. Do not make adjacency sound like production experience.\n" +
    "- If the user confirms several technologies in one answer, write one USER.md bullet or technology section per confirmed technology. Do not collapse them into a generic storage, backend, frontend, or tooling note.\n" +
    "- For confirmed missing technologies, prefer recording a skills-section category even when you also record experience-evidence bullets, so Step 3 has a direct place to consider the exact keyword. If you are unsure about resume placement but the user confirmed the technology, record that it can be listed in the skills section and finish.\n" +
    "- Optimistically infer likely employer/project context from the resume, but only record confirmed user experience or confirmed non-experience. Do not ask the user to choose resume edit placement; Step 3 planning owns that decision.\n" +
    "- When calling finish_tailor_resume_interview, include USER.md edit operations for every durable fact from the entire chat that is not already reflected in the current USER.md. Do not write only the latest user message if earlier answers in the same chat confirmed other technologies or constraints.\n",
  tailorResumeImplementation:
    "{{FEEDBACK_BLOCK}}Implement the approved resume edit plan as exact LaTeX block replacements. The strategic edit choices, targeted segments, and desired visible text are already decided.\n\n" +
    "You must return a strict JSON object containing only changes.\n\n" +
    "Implementation rules:\n" +
    "- Return exactly one LaTeX replacement for every planned segmentId and no extras.\n" +
    "- latexCode must contain only the replacement for that one segment.\n" +
    "- Never include content from the previous or next segment inside the same latexCode string.\n" +
    "- Never invent, rename, or return % JOBHELPER_SEGMENT_ID comments. The server re-adds them deterministically after applying your edits.\n" +
    "- Keep the replacement faithful to the targeted block's existing shape. If the source block is one bullet, return one bullet. If the source block is an opening wrapper plus one bullet, return only that opening wrapper plus one bullet.\n" +
    "- Do not add or remove neighboring bullets, \\end{...} lines, or surrounding wrappers unless they are part of that exact targeted block.\n" +
    "- Use the planned desired text as the target visible output, but preserve the source block's macro style, argument structure, and local formatting conventions whenever possible.\n" +
    "- If the desired text is an empty string, use an empty latexCode when removing that single planned bullet or line is clearly the right implementation. Do not leave an empty \\resumeitem{}, placeholder text, or a comment.\n" +
    "- Prefer replacements whose visible text stays at or under the source block's character count when possible. Rewrite for higher signal instead of simply adding more words.\n" +
    "- Small length increases are acceptable when they materially improve fit for the role, but bias strongly against cumulative growth because the resume should stay under one page.\n" +
    "- Across all planned edits, avoid adding more than about 1-2 lines total unless that extra length is clearly necessary for a meaningfully better tailored resume.\n" +
    "- If user-confirmed background learnings are provided, you may use them only in the targeted segments they reference. Do not spread them to unrelated blocks.\n" +
    "- Treat user-confirmed background learnings as factual additions, but never invent beyond what the user explicitly confirmed.\n" +
    "- Preserve factual and stylistic details that are outside the planned visible-text change. Do not change dates of experience, employers, titles, metrics, punctuation, separators, capitalization, or link text merely to polish the block.\n" +
    "- Use the emphasized technology list as keyword guidance. Include exact technology names where they are already supported by the source resume, USER.md, user-confirmed learnings, or the accepted planned desired text, but never add unsupported tools just because the job asks for them.\n" +
    "- If the accepted plan replaces a lower-signal bullet with user-confirmed technology experience, return that replacement as the single planned bullet. Do not move the technology only to skills and leave the planned experience bullet unchanged.\n" +
    "- Your primary goal is to implement the accepted Step 3 plan faithfully. Your secondary goal is to avoid keyword regressions from that accepted plan while keeping the block-scoped implementation compact. Do not make Step 4 stricter than Step 3 by inventing new coverage obligations that the accepted plan did not already satisfy.\n" +
    "- If the accepted plan adds actual skills to a skills section, preserve those planned skills entries. When the accepted plan uses a concrete actual skill in a bullet and also includes a Skills or Technical Skills replacement, make sure that replacement lists the same exact skill in the closest existing category. Do not treat the bullet mention as a substitute for the skills-list entry. Do not add extra capability phrases such as RESTful, RESTful APIs, cloud infrastructure, or data structures to Skills merely to improve keyword coverage; they belong in bullets only when the accepted plan already uses them there.\n" +
    "- Follow the Available tools section before final JSON.\n\n" +
    "Common pitfalls:\n" +
    "- The most common structural failure is crossing a segment boundary. When in doubt, keep the replacement smaller and closer to the source block.\n" +
    "- If the source block is \\entryheading, \\projectheading, or \\labelline, preserve the existing command form and adapt the text inside its arguments instead of flattening it into a different shape.\n" +
    "- Keep the final document pdflatex-compatible after your replacements are applied.\n" +
    "- Special character escaping: in plain text content, the characters }, {, #, %, &, $, _, ^, ~, and \\ are special in LaTeX and must be escaped (e.g., \\}, \\{, \\#, \\%, \\&, \\$, \\_, \\^{}, \\~{}, \\textbackslash{}). A bare } or { in text content is the most common cause of 'Extra }' or 'Missing $' compile errors. Only leave these characters unescaped inside LaTeX command arguments where they serve a structural role (e.g., \\textbf{...}, \\href{...}{...}).\n",
  tailorResumeRefinement:
    "{{FEEDBACK_BLOCK}}Revise the existing tailored resume block edits in response to the user's follow-up request.\n\n" +
    "You will receive:\n" +
    "- The raw original resume LaTeX before any tailoring edits.\n" +
    "- The latest model-generated block edits, including the original block, the model block, and the currently rendered block.\n" +
    "- Screenshot images of the current rendered PDF preview when available. These screenshots include the same review highlights shown to the user, so use them to judge both layout and how the edited regions look visually.\n" +
    "- The current tailoring thesis when available.\n" +
    "- The user's follow-up request describing how the edits should change.\n\n" +
    "Highlight key for the preview screenshots:\n" +
    "- Amber/yellow highlight = changed or rewritten text in an edited block.\n" +
    "- Green highlight = newly added text in an edited block.\n" +
    "- Blue highlight = the currently focused block when a focus pulse is visible.\n\n" +
    "Return a strict JSON object with:\n" +
    "- summary: one short paragraph describing what you changed.\n" +
    "- changes: exactly one replacement for every segmentId from the existing model edit list.\n\n" +
    "Refinement rules:\n" +
    "- Keep the exact same set of segmentIds. Do not add new segments, drop segments, or touch unedited blocks.\n" +
    "- latexCode must contain only the replacement for that one segment.\n" +
    "- Preserve each block's local structure. If the source is one bullet, return one bullet. Do not spill into neighboring blocks.\n" +
    "- Use the screenshots as a layout guardrail: prefer tighter, cleaner phrasing when the preview suggests the resume is too long, cramped, or wrapping awkwardly.\n" +
    "- Preserve factual accuracy. Never invent achievements, employers, dates, titles, technologies, metrics, degrees, or certifications.\n" +
    "- Keep the tailored resume pdflatex-compatible.\n" +
    "- If a block is already good, you may return it unchanged, but you must still include it in changes.\n" +
    "- Each returned reason fully replaces the old saved reason for that block, so it must stand on its own. Restate why the final wording is better for the role or better for the visible resume, and do not make the reason just say that the block was shortened, compressed, or made shorter.\n" +
    "- If helpful, a reason may mention a stronger but longer discarded option in this pattern: \"A stronger version could look like the following, but was not chosen because it would add an extra line: ...\" Use that only when it adds real explanatory value.\n" +
    "- When the request is about page count, overflow, or saving space, use the rendered PDF screenshots to judge whether an edit actually removes a full rendered line. Avoid edits that make a two-line bullet merely a little shorter while keeping the same vertical footprint.\n" +
    "- If the PDF suggests that only one line needs to be reclaimed overall, prefer one minimal edit to one original block and keep the rest of the edited blocks otherwise the same unless another change is clearly necessary.\n" +
    "- Avoid resume-wide rewrites. Make the smallest set of block-level improvements that satisfy the follow-up request.\n" +
    "- Special character escaping still matters in plain text content: escape }, {, #, %, &, $, _, ^, ~, and \\\\ when they are literal text rather than LaTeX structure.\n",
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
    buildTailorResumePlanningToolContractBlock(),
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

  return [
    prompt,
    buildTailorResumeImplementationTechnologyContextBlock(),
    buildTailorResumeImplementationUserMarkdownFormattingBlock(),
    buildTailorResumeImplementationToolContractBlock(),
  ].join("\n\n").trim();
}

export function buildTailorResumeInterviewSystemPrompt(
  settings: SystemPromptSettings,
  input: {
    debugForceConversation?: boolean;
  },
) {
  const prompt = renderSystemPromptTemplate(settings.tailorResumeInterview, {
    DEBUG_FORCE_BLOCK: buildTailorResumeInterviewDebugBlock({
      debugForceConversation: input.debugForceConversation === true,
    }),
    FEEDBACK_BLOCK: "",
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
