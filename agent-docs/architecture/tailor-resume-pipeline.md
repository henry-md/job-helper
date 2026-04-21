Tailor Resume pipeline:

- Purpose: Tailor Resume is intentionally staged. We do not ask one model call to invent strategy, ask the user questions, write final LaTeX, and rescue page-count overflow all at once.
- The signed-out preview, product copy, and architecture docs should all describe the same pipeline shape.

Step 0. Generate LaTeX base resume
- Save the uploaded resume locally.
- Extract a LaTeX version of the resume and recover link hints when possible.
- Compile a preview PDF from that base before any job-specific tailoring starts.
- The generated LaTeX becomes the authoritative editing surface for later stages.

Step 1. Generate plaintext generalized edits
- The planning stage sees whole-resume plaintext plus document-ordered plaintext blocks keyed by `segmentId`.
- It returns a tailoring thesis plus generalized plaintext edits for targeted blocks.
- This stage decides what should change, but it does not write final LaTeX yet.

Step 2. Ask user clarifications if useful
- This stage is optional and should keep a high threshold.
- The settings page has a per-user generation guardrail that controls whether this stage is allowed to pause and ask the user questions. It defaults on. When turned off, generation skips interactive questions and proceeds with the saved resume plus `USER.md` memory as non-interactive context.
- The stage receives the logged-in user's DB-backed `USER.md` memory and should use it to avoid asking repetitive questions about already-confirmed experience, non-experience, preferences, or constraints.
- Ask one question at a time only when a grounded answer could materially improve an already-adjacent resume block.
- Questions should concisely state the job-description signal, the resume gap, and 1-2 brief examples of strong answer shapes tailored to that job-description signal.
- Technology questions should only cover close neighbors of resume-supported experience that also appear in the job description, such as a framework adjacent to strong JavaScript experience or C adjacent to listed C++ experience.
- Store the questioning agenda, question budget, and learned facts mapped back to target `segmentId`s so later stages can use them surgically.
- When the user's answer reveals durable context likely to matter later, the interview tool may submit `USER.md` markdown patch operations. Normal additions should append under a chosen heading path; restructuring should use exact-match replace/insert/delete operations. Failed exact matches are fed back to the model for a retry instead of allowing full-document replacement.

Step 3. Generate block-scoped edits
- The implementation stage takes the accepted plan plus any user-confirmed learnings and returns exact LaTeX replacements for only the targeted segments.
- Failures here should retry the block-edit stage rather than forcing the model to rethink the whole thesis.
- The goal is segment-safe replacements that preserve local LaTeX structure.
- Block replacements should not polish unrelated details such as punctuation, dates of experience, employers, titles, metrics, separators, capitalization, or links.

Step 4. Condense edits to keep page size from growing
- If the tailored preview exceeds the source resume's page count, run a compaction/refinement loop over the edited blocks only.
- Use rendered PDF line measurements to estimate how many lines must be recovered, annotate original/current blocks with measured line counts, and ask the model only for candidates it believes can remove a rendered line.
- Measure candidate replacements in the full LaTeX document and accept only candidates whose exact block-level rendered line count drops versus both the current Step 3 replacement and the original block when that original measurement is available. Keep the Step 3 edit for any candidate that does not create a user-visible line reduction.
- Step 4 reasons should lead with the job-description fit change and mention shortening only as a passing fragment, not as the main justification.
- Rebuild from the immutable Step 3 edit set plus accepted reductions and repeat until the compiled preview empirically fits or the attempt budget is exhausted.
- Persist `generatedByStep` on every review block: `3` for Step 3 implementation output and `4` only when Step 4 accepted a replacement for that block. When `DEBUG_UI` is enabled, review cards show this as a lower-right badge with hover context.
- This is a follow-up guardrail stage, not a second full-resume rewrite.

Retry model:
- Extraction can retry LaTeX generation when the first pass is invalid.
- Planning can retry independently if the structured plan is empty or malformed.
- Block-scoped implementation retries stay local to the selected segments and compile validation.
- Page-count compaction retries stay local to the edited blocks until the preview fits or the attempt budget is exhausted.
- Design goal: retry the failing stage, not the entire pipeline.

Relevant code paths:
- Extraction: `lib/tailor-resume-extraction.ts`
- Planning + implementation: `lib/tailor-resume-tailoring.ts`
- Optional questioning: `lib/tailor-resume-questioning.ts`
- Page-count compaction: `lib/tailor-resume-page-count-compaction.ts`
- Prompt definitions: `lib/system-prompt-settings.ts`
- Route orchestration + persistence: `app/api/tailor-resume/route.ts`
