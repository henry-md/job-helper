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
- Priority should come from explicit posting text, especially required/basic/minimum and preferred/nice-to-have sections.
- After extraction, classify every keyword as skills-section, narrative, or non-skill. This is a resume-placement taxonomy: `skills_section` means the exact keyword could plausibly appear as a standalone entry in the resume's Skills/Technical Skills section. Technical-sounding, high-priority, or ATS-relevant phrases that belong in bullet wording instead are `narrative`. Stored user/backend classifications win first; the model only classifies keywords that have no stored record yet.
- The extension popup shows the keywords in a draggable high/low by skills-section/narrative matrix plus a non-skill area. Dragging a badge immediately persists the classification and re-evaluates any Step 2 checkpoints for that user.
- The extension should surface these keywords as soon as this deterministic/model-assisted scan finishes. Later stages do not start until the user reviews the matrix and presses play.

Step 2. Review skills-section blockers
- Step 2 is no longer an AI chat. It is a deterministic checkpoint over the Step 1 keywords, current resume text, and first-class skill/spare-bullet data.
- A run is blocked only when a high-priority skills-section keyword is absent from the current source resume and has no stored support through a skills-section skill, skills-only support, or a spare bullet.
- Narrative keywords and non-skills do not block. They remain visible in keyword coverage and can guide later wording, but the user is not forced to author support for each one.
- USER.md remains editable for future preferences and loose notes, but it is no longer the durable storage layer for skills-section support.
- Saving a keyword classification, skills-section skill, skills-only support, or spare bullet immediately rechecks all pending Step 2 checkpoints for the user.
- Even when no blockers remain, Step 2 remains a review gate. The UI shows a play action so the user can inspect the keyword matrix and optionally reclassify a term before Step 3 begins.

Step 3. Generate plaintext targeted edit plan
- The OpenAI planning stage runs only after Step 2 is unblocked and the user presses play.
- It sees whole-resume plaintext, document-ordered plaintext blocks keyed by `segmentId`, the job description, emphasized technologies from Step 1, current `USER.md`, and structured skills-section support evidence from the first-class skill/spare-bullet tables.
- It returns a tailoring thesis plus generalized plaintext edits for targeted blocks.
- This stage decides what should change, but it does not write final LaTeX yet.
- When a spare bullet has `replacesQuote`, the server fuzzily searches the chosen resume experience's current bullet segments and passes the top replacement candidate, confidence, and current text as deterministic evidence. The durable source of truth is the quoted text plus required resume experience, not a long-lived source segment id.
- When a skills/technical-skills block is editable, Step 3 should add only skills-section keywords or skills-only support. Narrative keywords may influence phrasing in experience bullets but should not be forced into Skills.

Step 4. Generate block-scoped edits
- The implementation stage takes the accepted plan plus any user-confirmed learnings and returns exact LaTeX replacements for only the targeted segments.
- It also receives the Step 1 emphasized-technology list as keyword guidance. Include high-priority terms wherever they are factually supported by the source resume, `USER.md`, interview learnings, or accepted plan; do not invent unsupported technology experience.
- When Step 4 adapts a sentence or quoted bullet from `USER.md`, translate Markdown bold spans into LaTeX `\textbf{...}` and, when appropriate, bold only one or two exact job-emphasized words or short phrases rather than the whole sentence.
- Failures here should retry the block-edit stage rather than forcing the model to rethink the whole thesis.
- The goal is segment-safe replacements that preserve local LaTeX structure.
- Block replacements should not polish unrelated details such as punctuation, dates of experience, employers, titles, metrics, separators, capitalization, or links.

Step 4b. Condense edits to keep page size from growing
- Page-count growth is always invalid. If the tailored preview exceeds the source resume's page count, run a compaction/refinement loop over the edited blocks only.
- Use rendered PDF line measurements to estimate how many lines must be recovered, annotate original/current blocks with measured line counts, and ask the model only for candidates it believes can remove a rendered line.
- The compaction pass should self-check before final submission: let the model call the rendered-line measurement tool, read the exact acceptance/rejection result, revise if needed, and only then submit the final candidate set for server-side validation.
- Measure candidate replacements in the full LaTeX document and accept only candidates whose exact block-level rendered line count drops versus the current working replacement for that block, whether that current state came from Step 4 or a prior accepted Step 5 reduction. Keep the current block version for any candidate that does not create a user-visible line reduction.
- Compaction reasons should lead with the job-description fit change and mention shortening only as a passing fragment, not as the main justification.
- Rebuild from the immutable Step 4 edit set plus accepted reductions and repeat until the compiled preview empirically fits or the attempt budget is exhausted.
- Retry context should include concise memory of prior measured failures, including the segment, candidate snippet, current/original/candidate line counts, and rejection reason, so later attempts avoid recycling the same same-line-count edits.
- Persist `generatedByStep` on every review block: `4` for initial block generation and `5` only when the compaction guardrail accepted a replacement for that block. When `DEBUG_UI` is enabled, review cards show this as a lower-right badge with hover context.
- This is a follow-up guardrail stage, not a second full-resume rewrite.

Retry model:
- Extraction can retry LaTeX generation when the first pass is invalid.
- Step 1 keyword extraction can fall back to deterministic hints if model-assisted keyword extraction fails.
- Step 2 has no model output. It can only wait for user data, become ready, or start Step 3 when the user presses play.
- Planning can retry independently if the structured plan is empty or malformed.
- Block-scoped implementation retries stay local to the selected segments and compile validation.
- Page-count compaction retries stay local to the edited blocks until the preview fits or the attempt budget is exhausted, and they use their own retry budget instead of borrowing the generic edit-stage retry count.
- Design goal: retry the failing stage, not the entire pipeline.

Failure logging:
- Durable Tailor Resume debug logs are stored in the `LatexBuildFailure` table. The table name is historical; it now stores structured Tailor Resume debug payloads as well as compile failures.
- Every failed step event writes a JSON payload through `logTailorResumeStepFailure`. The JSON payload is stored in the table's `latexCode` text field and includes the run id, application id, job URL, job-description snapshot, step number, attempt, retrying state, duration, and failure detail.
- Terminal run failures also write a `step-N-failure` payload with `logKind: "terminal-run-status"` so backend errors that do not pass through a normal model retry path still persist.
- Existing specialized debug artifacts remain in the same table: extraction compile failures, Step 2 OpenAI/API errors, Step 4 invalid replacements, and tailoring compile failures.
- `/debug/errors` is the operator-facing view for these records. `TailorResumeRun` is only the latest run-status snapshot for the UI and should not be treated as the durable failure history.

Relevant code paths:
- Extraction: `lib/tailor-resume-extraction.ts`
- Step 1 keyword extraction + Step 3 planning + Step 4 implementation: `lib/tailor-resume-tailoring.ts`
- First-class skill/spare-bullet storage: `lib/tailor-resume-skill-store.ts`
- Page-count compaction: `lib/tailor-resume-page-count-compaction.ts`
- Prompt definitions: `lib/system-prompt-settings.ts`
- Route orchestration + persistence: `app/api/tailor-resume/route.ts`
