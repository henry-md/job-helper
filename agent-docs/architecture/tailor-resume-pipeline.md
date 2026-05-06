Tailor Resume pipeline:

- Purpose: Tailor Resume is intentionally staged. We do not ask one model call to invent strategy, ask the user questions, write final LaTeX, and rescue page-count overflow all at once.
- The signed-out preview, product copy, architecture docs, comments, and step labels should all describe the same pipeline shape.

Step 0. Generate LaTeX base resume
- Save the uploaded resume locally.
- Extract a LaTeX version of the resume and recover link hints when possible.
- Compile a preview PDF from that base before any job-specific tailoring starts.
- The generated LaTeX becomes the authoritative editing surface for later stages.

Step 1. Scrape job keywords
- Extract a deduped list of job-description-emphasized technologies with high/low priority before planning starts.
- Priority should come from explicit posting text, especially required/basic/minimum and preferred/nice-to-have sections, and the stored shape should keep only the priority, technology name, and evidence.
- The extension should surface these keywords as soon as this deterministic/model-assisted scan finishes, even while later stages are still running.

Step 2. Clarify missing details
- If follow-up questions are enabled, Step 2 first computes deterministic keyword presence from the original resume text, Step 1 emphasized technologies, DB-backed `USER.md`, and saved non-technology terms. It creates a pending chat only when at least one scraped technology is missing from both the resume and `USER.md`.
- Clicking `Start chat` re-reads the latest `USER.md`. If no uncovered keywords remain, the run skips Step 2 and starts planning. If uncovered keywords remain, the server persists a hard-coded first assistant message with `technologyContexts` cards but no examples and no OpenAI call.
- The hard-coded first message asks whether examples should be generated. Clicking the small `Generate` action sends the first true Step 2 LLM request, which should answer with compact `technologyContexts` cards containing definitions and two example resume bullets per technology by default. If the user asks for more examples for a technology, keep using the card and return the requested count, up to the tool limit.
- Questions should skip vague, generic, product-only, or low-signal terms such as "internet terminology"; low-priority terms should join only when they are concrete and share an obvious likely insertion point with stronger terms.
- Step 2 no longer auto-generates follow-up chats after Step 1. Runs with uncovered keywords store a `pending` interview marker and show a `Start chat` action; only that click reads the latest `USER.md`, so parallel runs can benefit from edits made by earlier chats.
- Step 2 interview tools deliberately separate display from mutation. `initiate_tailor_resume_probing_questions` is presentation-only (`assistantMessage` plus optional `technologyContexts` cards). `finish_tailor_resume_interview` is the only Step 2 tool that writes `USER.md` and ends the chat so the run can continue. `update_tailor_resume_non_technologies` is the only tool that removes rejected scraped keywords or persists non-technology deny-list terms. `skip_tailor_resume_interview` only records why no chat is useful.
- When the user's answer reveals durable context likely to matter later, `finish_tailor_resume_interview` should submit one end-of-chat `USER.md` markdown patch operation set. Normal additions should append under a chosen heading path; restructuring should use exact-match replace/insert/delete operations. Failed exact matches are fed back to the model for a retry instead of allowing full-document replacement.
- `USER.md` technology notes should say, for each discussed technology, whether the user has no experience, whether it can be listed in skills without changing an experience bullet, or a quoted candidate experience bullet plus the experience/project name and skills-section category that can support it.

Step 3. Generate plaintext targeted edit plan
- The OpenAI planning stage runs after Step 2 has either skipped questions or finished applying the user's `USER.md` update.
- It sees whole-resume plaintext, document-ordered plaintext blocks keyed by `segmentId`, the job description, emphasized technologies from Step 1, and current `USER.md`.
- It returns a tailoring thesis plus generalized plaintext edits for targeted blocks.
- This stage decides what should change, but it does not write final LaTeX yet.
- When a skills/technical-skills block is editable, Step 3 should add only actual skills: concrete tools, languages, frameworks, databases, infrastructure tools, developer tools, or named methods supported as real skills by the source resume or by a dedicated `USER.md` sentence/bullet for the exact technology. Capability phrases used for ATS peppering, such as `RESTful`, `RESTful APIs`, `cloud infrastructure`, or `data structures`, should stay out of Skills unless `USER.md` explicitly says that exact phrase can be listed as a skill. Skills-only tools such as Windsurf can be added to Skills from a dedicated `USER.md` note without forcing an experience bullet.
- If Step 2 collected user-confirmed learnings, attach the compact questioning summary to the accepted plan so implementation can use those facts surgically.

Step 4. Generate block-scoped edits
- The implementation stage takes the accepted plan plus any user-confirmed learnings and returns exact LaTeX replacements for only the targeted segments.
- It also receives the Step 1 emphasized-technology list as keyword guidance. Include high-priority terms wherever they are factually supported by the source resume, `USER.md`, interview learnings, or accepted plan; do not invent unsupported technology experience.
- When Step 4 adapts a sentence or quoted bullet from `USER.md`, translate Markdown bold spans into LaTeX `\textbf{...}` and, when appropriate, bold only one or two exact job-emphasized words or short phrases rather than the whole sentence.
- Failures here should retry the block-edit stage rather than forcing the model to rethink the whole thesis.
- The goal is segment-safe replacements that preserve local LaTeX structure.
- Block replacements should not polish unrelated details such as punctuation, dates of experience, employers, titles, metrics, separators, capitalization, or links.

Step 5. Condense edits to keep page size from growing
- If the tailored preview exceeds the source resume's page count, run a compaction/refinement loop over the edited blocks only.
- Use rendered PDF line measurements to estimate how many lines must be recovered, annotate original/current blocks with measured line counts, and ask the model only for candidates it believes can remove a rendered line.
- Step 5 should self-check before final submission: let the model call the rendered-line measurement tool, read the exact acceptance/rejection result, revise if needed, and only then submit the final candidate set for server-side validation.
- Measure candidate replacements in the full LaTeX document and accept only candidates whose exact block-level rendered line count drops versus the current working replacement for that block, whether that current state came from Step 4 or a prior accepted Step 5 reduction. Keep the current block version for any candidate that does not create a user-visible line reduction.
- Step 5 reasons should lead with the job-description fit change and mention shortening only as a passing fragment, not as the main justification.
- Rebuild from the immutable Step 4 edit set plus accepted reductions and repeat until the compiled preview empirically fits or the attempt budget is exhausted.
- Retry context should include concise memory of prior measured failures, including the segment, candidate snippet, current/original/candidate line counts, and rejection reason, so later attempts avoid recycling the same same-line-count edits.
- Persist `generatedByStep` on every review block: `4` for Step 4 implementation output and `5` only when Step 5 accepted a replacement for that block. When `DEBUG_UI` is enabled, review cards show this as a lower-right badge with hover context.
- This is a follow-up guardrail stage, not a second full-resume rewrite.

Retry model:
- Extraction can retry LaTeX generation when the first pass is invalid.
- Step 1 keyword extraction can fall back to deterministic hints if model-assisted keyword extraction fails.
- Step 2 question decisions can retry invalid interview tool outputs without starting the chat until a valid ask/skip decision exists.
- Planning can retry independently if the structured plan is empty or malformed.
- Block-scoped implementation retries stay local to the selected segments and compile validation.
- Page-count compaction retries stay local to the edited blocks until the preview fits or the attempt budget is exhausted, and they use a Step-5-specific retry budget instead of borrowing the generic edit-stage retry count.
- Design goal: retry the failing stage, not the entire pipeline.

Failure logging:
- Durable Tailor Resume debug logs are stored in the `LatexBuildFailure` table. The table name is historical; it now stores structured Tailor Resume debug payloads as well as compile failures.
- Every failed step event from steps 1-5 writes a JSON payload through `logTailorResumeStepFailure`, with sources named `step-1-failure` through `step-5-failure`. The JSON payload is stored in the table's `latexCode` text field and includes the run id, application id, job URL, job-description snapshot, step number, attempt, retrying state, duration, and failure detail.
- Terminal run failures also write a `step-N-failure` payload with `logKind: "terminal-run-status"` so backend errors that do not pass through a normal model retry path still persist.
- Existing specialized debug artifacts remain in the same table: extraction compile failures, Step 2 chat-served errors, Step 4 invalid replacements, and tailoring compile failures.
- `/debug/errors` is the operator-facing view for these records. `TailorResumeRun` is only the latest run-status snapshot for the UI and should not be treated as the durable failure history.

Relevant code paths:
- Extraction: `lib/tailor-resume-extraction.ts`
- Step 1 keyword extraction + Step 3 planning + Step 4 implementation: `lib/tailor-resume-tailoring.ts`
- Step 2 optional questioning: `lib/tailor-resume-questioning.ts`
- Page-count compaction: `lib/tailor-resume-page-count-compaction.ts`
- Prompt definitions: `lib/system-prompt-settings.ts`
- Route orchestration + persistence: `app/api/tailor-resume/route.ts`
