Tailor Resume object model:

1. Saved Resume Record (`SavedResumeRecord`)
- File: `lib/tailor-resume-types.ts`
- This tracks the uploaded source file under `public/uploads/resumes/<userId>/`.
- It stores filename, mime type, size, storage path, and timestamp.

2. Saved LaTeX (`TailorResumeLatexState`)
- Files: `lib/tailor-resume-types.ts`, `app/api/tailor-resume/route.ts`
- This is the only stored resume-content representation.
- OpenAI extraction returns a small structured payload containing just `latexCode`.
- The saved LaTeX lives in `latex.code`.
- Main fields:
  - `code`: the current saved LaTeX source of truth
  - `status`: preview compile status
  - `error`: last compile error when the draft does not render
  - `pdfUpdatedAt`: timestamp of the last successfully compiled preview PDF

3. Preview PDF (`Buffer`)
- Files: `lib/tailor-resume-storage.ts`, `app/api/tailor-resume/preview/route.ts`
- The preview PDF is compiled directly from `latex.code`.
- Successful compiles overwrite `.job-helper-data/tailor-resumes/<userId>/preview.pdf`.
- Failed edits keep the previous successful preview when one already exists.

Current flow:

1. Resume upload is saved locally.
2. OpenAI extraction produces LaTeX directly.
3. The extracted LaTeX is saved into `latex.code`.
4. `compileTailorResumeLatex(...)` compiles that LaTeX into the preview PDF.
5. The dashboard shows a split pane with raw LaTeX on the left and the rendered PDF on the right.
6. User edits save `latex.code`, then the preview recompiles from that exact LaTeX.

Important rule:

- LaTeX is the authoritative editing surface.
- Tailor Resume no longer stores or depends on a simplified structured resume object.

Relevant code paths:

- Extraction call: `lib/tailor-resume-extraction.ts`
- Prompt reference example/template: `lib/tailor-resume-latex-example.ts`
- LaTeX compile helper: `lib/tailor-resume-latex.ts`
- Saved profile + preview persistence: `lib/tailor-resume-storage.ts`
- API orchestration: `app/api/tailor-resume/route.ts`
- Preview route: `app/api/tailor-resume/preview/route.ts`
- Tailor Resume workspace: `components/tailor-resume-workspace.tsx`
- Raw LaTeX debug workspace: `components/debug-latex-workspace.tsx`

Testing:

- Legacy profile compatibility + LaTeX-only defaults: `tests/tailor-resume-profile.test.mts`
