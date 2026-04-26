Tailor Resume review preview highlighting:

- Purpose: Tailor Resume surfaces can show temporary edit highlighting without mutating the saved clean preview on disk.
- Entry points:
  - `components/tailored-resume-review-modal.tsx` uses the interactive preview renderer to paint overlay highlights on top of the clean compiled PDF.
  - `extension/src/App.tsx` exposes a fullscreen preview toggle that switches between the clean PDF iframe and a client-side highlighted overlay renderer in `extension/src/tailored-resume-overlay-preview.tsx`.
  - `app/api/tailor-resume/preview/route.ts` still accepts `highlights=true` and compiles an ephemeral highlighted PDF for PDF-only contexts that do not require pagination stability.

Implementation:

- The highlighted render starts from `tailoredResume.annotatedLatexCode`, not the already-compiled PDF.
- `lib/tailor-resume-preview-highlight.ts` reads the persisted segment markers, finds saved `record.edits`, and rewrites only the edited blocks before compile.
- The helper injects review-only LaTeX macros ahead of `\begin{document}`. These macros use `ulem`/`\markoverwith ... \ULon` instead of `\colorbox`, because `\colorbox` creates a rigid rectangle that does not wrap across lines cleanly.
- Each changed block is rebuilt from `beforeLatexCode` vs `afterLatexCode` with `buildTailoredResumeDiffRows(...)`.
- Added-only rows become green highlights; modified rows become amber highlights over just the added/replacement text.
- The in-app interactive renderer is separate from the highlighted PDF. It draws browser overlays on top of the clean compiled PDF, keeps all currently active segment diffs visible at once, and treats clicking an edit card as a temporary focus event that scrolls to the block and pulses the overlay without changing the steady highlight set.
- The extension's fullscreen diff-highlighting mode is also post-layout now. It renders the clean PDF locally with `pdf.js`, then paints the same diff-style overlays on top of that page canvas. This preserves the clean preview's pagination while avoiding the blur introduced by pre-rendered page images.
- The extension review payload needs raw `annotatedLatexCode` and `sourceAnnotatedLatexCode` so it can rebuild the same highlight queries the web review modal uses without recompiling a second highlighted PDF.
- The review modal's original/tailored LaTeX block panes sync vertical scrolling by diff row index. The source pane's top visible row and relative offset inside that row drive the other pane, with a short programmatic-scroll guard to avoid feedback loops. This keeps analogous rows lined up without requiring model output changes.

Multi-line highlight rule:

- Highlight runs are inline and breakable, so TeX can wrap them across lines naturally.
- For modified rows, the highlighted range starts at the first added diff segment and ends at the last added diff segment, so the preview uses one continuous visual region instead of many tiny token boxes.
- The tokenizer treats escaped punctuation such as `\%` plus inline punctuation commands like `\textasciitilde` as part of the same highlightable text run.
- Inline formatting boundaries such as `\textbf{...}` do not stay inside one outer `\jhlmod{...}` span. Instead, the helper highlights from inside the formatting command and keeps the surrounding plain text in adjacent highlight runs.
- Interior spaces and separators remain inside the neighboring split runs, so `\jhlmod{Used }\textbf{\jhlmod{AWS Amplify}}\jhlmod{ to set up }` still reads as one continuous highlighted band instead of separate word boxes.
- Each emitted highlight run also gets a tiny zero-width leading bleed overlay so browser PDF viewers do not leave a visible hairline seam when the next split run resumes after a formatting boundary.
- Structural commands such as `\resumeitem`, `\begin`, `\end`, comments, and line-breaking commands still force the helper to fall back to a safer split form.

Guardrails:

- Never persist the highlighted LaTeX or highlighted PDF as the canonical saved preview; the saved preview remains the clean compiled document.
- If highlighted compilation fails, the preview route should fall back to the stored clean PDF rather than breaking the review modal.
- For pagination-sensitive highlighted views, prefer post-layout overlays on top of the clean PDF instead of recompiling highlighted LaTeX. If image snapshots are considered as a fallback, treat the visual-quality tradeoff as a product decision rather than assuming rasterization is acceptable by default.
