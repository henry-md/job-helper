Tailor Resume review preview highlighting:

- Purpose: Tailor Resume surfaces can show temporary edit highlighting without mutating the saved clean preview on disk.
- Entry points:
  - `components/tailor-resume-workspace.tsx` uses the interactive preview renderer for source-resume Config previews.
  - `extension/src/App.tsx` exposes a fullscreen preview toggle that feeds the same `components/tailored-resume-interactive-preview.tsx` renderer in frameless mode.
  - `app/api/tailor-resume/preview/route.ts` returns the clean compiled PDF only; highlighting is a client-side overlay on that stable layout.

Implementation:

- The highlighted render starts from the clean compiled PDF plus `tailoredResume.annotatedLatexCode`, `sourceAnnotatedLatexCode`, and saved edits.
- `lib/tailor-resume-preview-focus.ts` reads the persisted segment markers, turns saved edits into text queries, and resolves added/changed ranges after PDF layout.
- Added-only ranges become green highlights; modified ranges become amber highlights over just the added/replacement text.
- The in-app interactive renderer is separate from the highlighted PDF. It draws browser overlays on top of the clean compiled PDF, keeps all currently active segment diffs visible at once, and treats clicking an edit card as a temporary focus event that scrolls to the block and pulses the overlay without changing the steady highlight set.
- The extension's fullscreen diff-highlighting mode uses the same shared interactive component in frameless mode. It renders the clean PDF locally with `pdf.js`, then paints the same diff-style overlays on top of that page canvas. This preserves the clean preview's pagination while avoiding the blur introduced by pre-rendered page images.
- The extension review payload needs raw `annotatedLatexCode` and `sourceAnnotatedLatexCode` so it can rebuild highlight queries without recompiling a second highlighted PDF.

Multi-line highlight rule:

- Highlight geometry is resolved after PDF layout from normalized text positions, so wrapped lines become multiple overlay rectangles instead of a LaTeX recompilation artifact.
- For modified rows, the highlighted range starts at the first added diff segment and ends at the last added diff segment, so the preview uses one continuous visual region instead of many tiny token boxes.
- Formatting boundaries such as `\textbf{...}` are converted to plain-text query ranges before matching the PDF text layer.

Guardrails:

- Never persist the highlighted LaTeX or highlighted PDF as the canonical saved preview; the saved preview remains the clean compiled document.
- Do not reintroduce backend highlighted-PDF compilation for the extension; use post-layout overlays on top of the clean PDF.
- If image snapshots are considered as a fallback, treat the visual-quality tradeoff as a product decision rather than assuming rasterization is acceptable by default.
