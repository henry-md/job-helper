Tailor Resume review preview highlighting:

- Purpose: the review modal can show a temporary highlighted PDF without mutating the saved clean preview on disk.
- Entry points:
  - `components/tailored-resume-review-modal.tsx` switches the iframe between the clean preview URL and the highlighted preview URL.
  - `app/api/tailor-resume/preview/route.ts` accepts `highlights=true` and compiles an ephemeral highlighted PDF for that response only.

Implementation:

- The highlighted render starts from `tailoredResume.annotatedLatexCode`, not the already-compiled PDF.
- `lib/tailor-resume-preview-highlight.ts` reads the persisted segment markers, finds saved `record.edits`, and rewrites only the edited blocks before compile.
- The helper injects review-only LaTeX macros ahead of `\begin{document}`. These macros use `ulem`/`\markoverwith ... \ULon` instead of `\colorbox`, because `\colorbox` creates a rigid rectangle that does not wrap across lines cleanly.
- Each changed block is rebuilt from `beforeLatexCode` vs `afterLatexCode` with `buildTailoredResumeDiffRows(...)`.
- Added-only rows become green highlights; modified rows become amber highlights over just the added/replacement text.

Multi-line highlight rule:

- Highlight runs are inline and breakable, so TeX can wrap them across lines naturally.
- For modified rows, the highlighted range starts at the first added diff segment and ends at the last added diff segment, so the preview uses one continuous visual region instead of many tiny token boxes.
- The tokenizer treats escaped punctuation such as `\%` plus inline punctuation commands like `\textasciitilde` as part of the same highlightable text run.
- Inline formatting boundaries such as `\textbf{...}` do not stay inside one outer `\jhlmod{...}` span. Instead, the helper highlights from inside the formatting command and keeps the surrounding plain text in adjacent highlight runs.
- Interior spaces and separators remain inside the neighboring split runs, so `\jhlmod{Used }\textbf{\jhlmod{AWS Amplify}}\jhlmod{ to set up }` still reads as one continuous highlighted band instead of separate word boxes.
- The helper also inserts a tiny zero-width bridge overlay before each resumed split run, which patches the visible hairline gap that `ulem` can leave between adjacent highlight runs at formatting boundaries.
- Structural commands such as `\resumeitem`, `\begin`, `\end`, comments, and line-breaking commands still force the helper to fall back to a safer split form.

Guardrails:

- Never persist the highlighted LaTeX or highlighted PDF as the canonical saved preview; the saved preview remains the clean compiled document.
- If highlighted compilation fails, the preview route should fall back to the stored clean PDF rather than breaking the review modal.
