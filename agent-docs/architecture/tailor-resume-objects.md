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
- Each saved tailored resume keeps:
  - the tailored LaTeX / annotated LaTeX snapshot
  - block-level edit history for review and later user overrides
  - a `thesis` object with:
    - `jobDescriptionFocus`: the non-generic themes where the job description over-indexed
    - `resumeChanges`: the broad resume strategy used to match those themes
- The review modal surfaces this thesis from saved profile data; it is not recomputed client-side.

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
- The tailoring flow now runs in two stages:
  - a planning pass that sees whole-resume plaintext plus document-ordered plaintext blocks keyed by `segmentId`
  - an implementation pass that sees only the selected blocks and translates the approved plaintext plan back into block-local LaTeX replacements
- Compile retries stay scoped to the implementation pass so LaTeX escaping and block-boundary fixes do not force the model to rethink the whole editing thesis on every retry.

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
- API orchestration: `app/api/tailor-resume/route.ts`
- Preview route: `app/api/tailor-resume/preview/route.ts`
- Tailor Resume workspace: `components/tailor-resume-workspace.tsx`
- Raw LaTeX debug workspace: `components/debug-latex-workspace.tsx`

Testing:

- Legacy profile compatibility + LaTeX-only defaults: `tests/tailor-resume-profile.test.mts`
