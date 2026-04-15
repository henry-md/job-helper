Tailor Resume object model:

1. Saved Resume Record (`SavedResumeRecord`)
- File: `lib/tailor-resume-types.ts`
- This tracks the uploaded source file under `public/uploads/resumes/<userId>/`.
- It stores filename, mime type, size, storage path, and timestamp.

2. Saved Link Records (`TailorResumeLinkRecord[]`)
- File: `lib/tailor-resume-types.ts`
- Stored under `profile.links`.
- Each link record keeps:
  - `key`: stable resume-local identifier derived from the visible label
  - `label`: the visible link text or link label from the resume
  - `url`: the saved destination, or `null` when the destination still needs user input or was intentionally removed
  - `disabled`: whether the user explicitly removed hyperlink styling for that label
  - `updatedAt`: last time that saved mapping changed
- These records are attached to the saved resume and reused on future extractions.
- If `disabled` is true, extraction must keep that label as plain text and strip `\href` / link-only styling during regeneration.
- The extraction flow also uses embedded PDF link annotations when available, but those URLs are only hints until they are validated or saved.

3. Saved LaTeX (`TailorResumeLatexState`)
- Files: `lib/tailor-resume-types.ts`, `app/api/tailor-resume/route.ts`
- LaTeX is still the main editable resume artifact.
- OpenAI extraction now returns both `latexCode` and structured link candidates.
- The saved LaTeX lives in `latex.code`.
- Main fields:
  - `code`: the current saved LaTeX source of truth
  - `status`: preview compile status
  - `error`: last compile error when the draft does not render
  - `pdfUpdatedAt`: timestamp of the last successfully compiled preview PDF

4. Preview PDF (`Buffer`)
- Files: `lib/tailor-resume-storage.ts`, `app/api/tailor-resume/preview/route.ts`
- The preview PDF is compiled directly from `latex.code`.
- Successful compiles overwrite `.job-helper-data/tailor-resumes/<userId>/preview.pdf`.
- Failed edits keep the previous successful preview when one already exists.

Current flow:

1. Resume upload is saved locally.
2. Extraction reads the file, recovers embedded PDF URLs when possible, and sends those plus any saved link records to OpenAI as link hints.
3. OpenAI returns LaTeX plus structured link candidates.
4. Link candidates are normalized and stored in `profile.links`.
5. If some link labels still have unknown destinations, the UI prompts the user once for those URLs and saves them back into `profile.links`.
6. The extracted LaTeX is saved into `latex.code`.
7. `compileTailorResumeLatex(...)` compiles that LaTeX into the preview PDF.
8. The dashboard shows a split pane with raw LaTeX on the left and the rendered PDF on the right.
9. User edits save `latex.code`, then the preview recompiles from that exact LaTeX.

Important rule:

- LaTeX is the authoritative editing surface.
- Tailor Resume no longer stores or depends on a simplified structured resume object, but it does persist link mappings alongside the LaTeX so future extractions can reuse them.

Relevant code paths:

- Extraction call: `lib/tailor-resume-extraction.ts`
- Link key + normalization helpers: `lib/tailor-resume-links.ts`
- Embedded PDF link recovery: `lib/tailor-resume-pdf-links.ts`
- Prompt reference example/template: `lib/tailor-resume-latex-example.ts`
- LaTeX compile helper: `lib/tailor-resume-latex.ts`
- Saved profile + preview persistence: `lib/tailor-resume-storage.ts`
- API orchestration: `app/api/tailor-resume/route.ts`
- Preview route: `app/api/tailor-resume/preview/route.ts`
- Tailor Resume workspace: `components/tailor-resume-workspace.tsx`
- Raw LaTeX debug workspace: `components/debug-latex-workspace.tsx`

Testing:

- Legacy profile compatibility + LaTeX-only defaults: `tests/tailor-resume-profile.test.mts`
