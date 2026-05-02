Tailor Resume object model:

1. Saved Resume Record (`SavedResumeRecord`)
- File: `lib/tailor-resume-types.ts`
- This tracks the uploaded source file under `public/uploads/resumes/<userId>/`.
- It stores filename, mime type, size, storage path, and timestamp.

2. Current Parsed Link Records (`TailorResumeLinkRecord[]`)
- File: `lib/tailor-resume-types.ts`
- Stored under `profile.links`.
- Each link record keeps:
  - `key`: stable resume-local identifier derived from the visible label
  - `label`: the visible link text or link label from the resume
  - `url`: the saved destination, or `null` when the destination still needs user input or was intentionally removed
  - `disabled`: whether the user explicitly removed hyperlink styling for that label
  - `updatedAt`: last time that saved mapping changed
- These records track the current parsed/source-resume link state for the active base resume.
- If `disabled` is true, extraction must keep that label as plain text and strip `\href` / link-only styling during regeneration.
- The extraction flow also uses embedded PDF link annotations when available, but those URLs are only hints until they are validated or saved.

3. Locked Link Records (`TailorResumeLockedLinkRecord[]`)
- Files: `prisma/schema.prisma`, `lib/tailor-resume-locked-links.ts`
- Persisted in Prisma as `TailorResumeLockedLink`.
- These are the immutable link-lock source of truth.
- Each locked link keeps:
  - `key`: the stable resume-local key that the lock applies to
  - `label`: the visible label associated with that key
  - `url`: the authoritative destination that should win on conflicts
  - `updatedAt`: last time the user explicitly changed the saved lock
- Only locked links are stored here.
- Unlocking a link deletes its `TailorResumeLockedLink` row immediately.

4. Saved LaTeX (`TailorResumeLatexState`)
- Files: `lib/tailor-resume-types.ts`, `app/api/tailor-resume/route.ts`
- LaTeX is still the main editable resume artifact.
- OpenAI extraction now returns both `latexCode` and structured link candidates.
- The saved LaTeX lives in `latex.code`.
- Main fields:
  - `code`: the current saved LaTeX document after the post-edit lock-injection pass
  - `status`: preview compile status
  - `error`: last compile error when the draft does not render
  - `pdfUpdatedAt`: timestamp of the last successfully compiled preview PDF

5. Tailored Resume Record (`TailoredResumeRecord`)
- Files: `lib/tailor-resume-types.ts`, `app/api/tailor-resume/route.ts`
- The full review/edit artifact is still stored in the Tailor Resume profile because the review UI reads this LaTeX-heavy shape directly.
- Extension-originated tailoring also creates a DB `TailoredResume` row that links the saved profile record to the tracked `JobApplication`.
- The DB row stores lightweight searchable/linkable metadata: profile record id, application id, job URL/hash, display name, company, role, status, and error.
- Each saved profile tailored resume keeps:
  - the tailored LaTeX / annotated LaTeX snapshot
  - one block-level edit record per changed `segmentId`
  - each block edit record stores three distinct LaTeX states:
    - `beforeLatexCode`: the original source-resume block
    - `afterLatexCode`: the OpenAI-tailored suggestion for that same block
    - `customLatexCode`: an optional user-authored override for the same block
  - the review timeline should stay keyed to the model edit record, not create separate timeline rows for custom user overrides
  - the saved plaintext planning payload from the first tailoring pass, including:
    - planned `segmentId` edits
    - desired plaintext rewrites per block
    - the planner thesis + metadata
    - `jobIdentifier`, which should prefer a visible job/requisition/posting id and fall back to the usual short disambiguator when no job number is available
  - `jobUrl`, when the run came from a captured job page or a description with a URL header; URL matching lets the API return an existing tailored resume instead of generating a duplicate for the same posting
  - the saved OpenAI debug trace for developer inspection, including:
    - the full prompt for the stage-1 plaintext planning call
    - the full JSON output returned by the stage-1 call
    - the full prompt for the stage-2 LaTeX implementation call
    - the full JSON output returned by the stage-2 call
  - a `thesis` object with:
    - `jobDescriptionFocus`: the non-generic themes where the job description over-indexed
    - `resumeChanges`: the broad resume strategy used to match those themes
- The review modal surfaces this thesis from saved profile data; it is not recomputed client-side.
- When `DEBUG_UI` is enabled, the tailored-resume review exposes those four saved stage transcripts in collapsible sections so developers can inspect the exact prompts and outputs without rerunning tailoring.

6. Preview PDF (`Buffer`)
- Files: `lib/tailor-resume-storage.ts`, `app/api/tailor-resume/preview/route.ts`
- The preview PDF is compiled from a derived LaTeX string based on `latex.code`.
- Before compile, Tailor Resume runs a separate processing pass that:
  - reparses the current LaTeX into current link records
  - merges in stored locked links by `key`, defaulting to the locked value on conflicts
  - injects locked URLs back into matching LaTeX link/plain-text occurrences
  - strips disabled links back to plain text
- Successful compiles overwrite `.job-helper-data/tailor-resumes/<userId>/preview.pdf`.
- Failed edits keep the previous successful preview when one already exists.

7. Tailor Resume Run (`TailorResumeRun`)
- Files: `prisma/schema.prisma`, `app/api/tailor-resume/route.ts`
- Extension-originated tailoring creates or reuses a `JobApplication` for the normalized job URL before model generation begins.
- A `TailorResumeRun` row tracks the generation state for that application:
  - `RUNNING` while the pipeline is actively generating
  - `NEEDS_INPUT` while the follow-up interview is waiting on the user
  - `SUCCEEDED` after a saved tailored resume row is linked
  - `FAILED` for generation or validation failure
  - `CANCELLED` when the user cancels/overwrites an active run
- Run rows carry the latest step number/count/status/summary/detail/attempt/retry state so duplicate-tailoring checks can tell the user exactly what the existing run is doing.
- The pending interview stored in the file-backed profile includes the DB `applicationId` and `tailorResumeRunId` so continuing an interview updates the same run row.
- Duplicate checks for extension tailoring should prefer DB state for the normalized job URL/application: active run first, completed linked tailored resume second.

8. Prompt Settings (`TailorResumePromptSettingsState`)
- Files: `lib/system-prompt-settings.ts`, `lib/tailor-resume-types.ts`
- Stored under `profile.promptSettings`.
- This keeps the per-user system-prompt templates that power:
  - job application extraction
  - resume-to-LaTeX extraction
  - tailored-resume planning
  - optional tailored-resume follow-up questioning between planning and implementation
  - tailored-resume block generation
  - tailored-resume block refinement / regeneration
  - automatic page-count compaction when a tailored resume grows beyond the original resume's page count
- The stored values are editable from `/dashboard?tab=settings`.
- The prompt strings may include template tokens such as `{{FEEDBACK_BLOCK}}`, `{{RETRY_INSTRUCTIONS}}`, and `{{MAX_ATTEMPTS}}`; runtime code expands those tokens before sending the final instructions to OpenAI.
- Missing keys fall back to the shipped defaults so older saved profiles remain forward-compatible when new prompt-controlled flows are added.

9. Generation Settings (`TailorResumeGenerationSettingsState`)
- Files: `lib/tailor-resume-generation-settings.ts`, `lib/tailor-resume-types.ts`
- Stored under `profile.generationSettings`.
- This keeps per-user boolean generation guardrails that are not prompt text themselves.
- Current user-editable settings include whether Step 2 may pause for follow-up questions, whether tailoring should automatically reject page-count growth by running a compaction follow-up pass when needed, plus the keyword-coverage percentage basis.
- Step 2 follow-up questions are a real product setting, so the toggle must be visible from the extension settings panel as well as the web dashboard before saved `allowTailorResumeFollowUpQuestions` state is allowed to affect a run.
- Generation settings are versioned; unversioned/older saved Step 2-off values are legacy hidden state and are migrated back to on when read. Once the visible switch saves version 2, off remains an explicit user choice.
- These values are editable from `/dashboard?tab=settings`; extension-started behavior-affecting settings must also be visible in the extension settings panel.

10. User Memory (`TailorResumeUserMemory`)
- Files: `prisma/schema.prisma`, `lib/tailor-resume-user-memory.ts`
- Stored in Prisma as a DB-backed Markdown document for the logged-in user, exposed as `USER.md` in settings.
- The Step 2 tailoring interview receives this Markdown so it can avoid repeating questions the user has already answered.
- The interview model can update the document with markdown patch operations:
  - `append` under a chosen heading path for ordinary new memory
  - `replace_exact`, `insert_before`, `insert_after`, and `delete_exact` for deliberate restructuring
- Exact-match operations must match once; failures are returned as structured retry feedback. Full-document replacement is intentionally not part of the model-facing edit contract.

Current flow:

1. Resume upload is saved locally.
2. Extraction reads the file, recovers embedded PDF URLs when possible, and sends the current parsed links plus all persisted locked links to OpenAI as link hints.
3. OpenAI returns LaTeX plus structured link candidates.
4. Link candidates are normalized and stored in `profile.links`.
5. If some link labels still have unknown destinations, the UI prompts the user once for those URLs and saves them back into `profile.links`.
6. The extracted LaTeX is saved into `latex.code`.
7. `compileTailorResumeLatex(...)` compiles a derived version of that LaTeX into the preview PDF after applying disabled-link removals plus Prisma-backed locked-link injections.
8. The dashboard shows a split pane with raw LaTeX on the left and the rendered PDF on the right.
9. User edits first reparse the latest LaTeX into current links, then merge in stored locked links by key, then save the lock-processed LaTeX back into `latex.code` so the editor/preview both reflect the saved locked destinations.

Tailoring generation:

- Tailor Resume no longer asks one model call to decide the strategy and write final LaTeX at the same time.
- The tailoring flow now runs in two required stages plus one optional middle stage:
  - parallel Step 1 work: an OpenAI planning pass over whole-resume plaintext and document-ordered blocks, plus deterministic keyword scraping from the job posting
  - an optional follow-up questioning pass that waits for both Step 1 results, then can pause the flow and ask the user a few high-value background questions before implementation
  - an implementation pass that sees only the selected blocks and translates the approved plaintext plan plus any compressed user learnings back into block-local LaTeX replacements
- The questioning pass should stay rare. It should only ask when the answer would materially improve the tailored resume, cannot already be inferred from the current resume, and is adjacent enough to existing resume text that the experience is plausibly already there.
- If the visible Step 2 setting is enabled, Step 2 may still decide to skip questions, but that decision must come from the Step 2 model/tool path using the current resume, job keywords, and `USER.md`, not from hidden persisted profile state.
- If the visible Step 2 setting is disabled, the flow skips interactive questioning and passes `USER.md` memory as non-interactive context to planning and implementation.
- When questioning does happen, persist only a compact summary of the learnings for the next model stage rather than forwarding the full chat transcript.
- Existing `USER.md` memory can be copied into the compact learning summary when it answers a planned edit's factual gap; new durable facts from user answers can be written back to `USER.md` through patch operations.
- When the page-count guardrail is enabled and the compiled tailored preview exceeds the original resume's page count, the flow runs a third conditional stage:
  - a refinement-style compaction pass that re-prompts only the existing edited blocks, sends highlighted rendered preview screenshots, and retries until the preview fits within the original page count or the attempt budget is exhausted
- Compile retries stay scoped to the implementation pass so LaTeX escaping and block-boundary fixes do not force the model to rethink the whole editing thesis on every retry.
- Extension-originated tailoring should pass the captured job URL separately from the job-description text and create/reuse a tracked `JobApplication` for the normalized URL before generation starts. The API should store live run state in `TailorResumeRun`; if the same application already has an active run or a linked tailored resume, return a conflict payload so the extension can ask whether to cancel/keep or overwrite.

Important rule:

- LaTeX is the authoritative editing surface.
- Locked links are a separate authority layer from the user edit itself and are re-applied during the save/preview/tailoring processing pass.
- The file-backed profile stores current parsed links, not the immutable lock source of truth.
- Tailor Resume no longer stores or depends on a simplified structured resume object, but it does persist current link mappings alongside the raw LaTeX so future extractions and derived processing can reuse them.

Relevant code paths:

- Extraction call: `lib/tailor-resume-extraction.ts`
- Locked-link persistence + merge helpers: `lib/tailor-resume-locked-links.ts`
- Profile hydration + legacy lock migration: `lib/tailor-resume-profile-state.ts`
- Link key + normalization helpers: `lib/tailor-resume-links.ts`
- Embedded PDF link recovery: `lib/tailor-resume-pdf-links.ts`
- Prompt reference example/template: `lib/tailor-resume-latex-example.ts`
- LaTeX compile helper: `lib/tailor-resume-latex.ts`
- Review highlight implementation notes: `agent-docs/architecture/tailor-resume-preview-highlighting.md`
- Saved profile + preview persistence: `lib/tailor-resume-storage.ts`
- User memory persistence + patching: `lib/tailor-resume-user-memory.ts`
- API orchestration: `app/api/tailor-resume/route.ts`
- Preview route: `app/api/tailor-resume/preview/route.ts`
- Tailor Resume workspace: `components/tailor-resume-workspace.tsx`
- Raw LaTeX debug workspace: `components/debug-latex-workspace.tsx`

Testing:

- Legacy profile compatibility + LaTeX-only defaults: `tests/tailor-resume-profile.test.mts`
