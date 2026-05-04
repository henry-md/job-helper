Problem:
- Two regressions appeared while wiring the chrome-extension diff-highlighting toggle to share rendering with the web app's tailored-resume preview. Together they manifested as: the toggle either hung on a "Loading…" spinner forever, rendered the PDF with broken layout chrome ("Interactive render" header, tiny squashed PDF on a light card), or after a follow-up "fix" the entire side-panel went blank.

Causes:

1. pdfjs-dist worker URL 404s in crxjs+Vite dev mode.
   - `pdfjs-dist/webpack.mjs` unconditionally runs
     `GlobalWorkerOptions.workerPort = new Worker(new URL("./build/pdf.worker.mjs", import.meta.url), { type: "module" })`
     at module load.
   - In Next.js (web app) webpack rewrites that URL into a real bundled chunk.
   - In the extension's crxjs+Vite dev server it rewrites to
     `/node_modules/.vite/deps/build/pdf.worker.mjs?worker_file&type=module`,
     which the dev server returns 404 for.
   - Result: pdf.js never gets a working worker; `loadingTask.promise` never
     resolves; the toggle sits on "Loading…" indefinitely.

2. The shared web component is not portable to the extension panel.
   - `components/tailored-resume-interactive-preview.tsx` renders its own UI
     chrome (an "Interactive render" header bar, light gradient background,
     white card framing) and styles every layout primitive with Tailwind
     utility classes (`flex h-full min-h-0 flex-col`, `bg-[linear-gradient(...)]`,
     `border-b bg-white/80 backdrop-blur-sm`, etc.).
   - The chrome extension has no Tailwind in its build pipeline and uses its
     own dark-themed custom CSS. Re-exporting the shared component into the
     extension renders all those utility classes as no-ops, which collapses
     the layout (PDF squashed to intrinsic size, header floating on the wrong
     background) and the highlight overlay <div>s render unstyled because
     `.resume-interactive-highlight*` rules also live in `app/globals.css`.
   - The "obvious" fix of installing `@tailwindcss/vite` in the extension is
     a regression hazard: Tailwind v4's preflight reset clobbers the
     extension's existing custom CSS and the side-panel renders blank.

Fix:
- Keep two thin component shells, one per app, instead of forcing a single
  shared rendering component.
  - Web app: `components/tailored-resume-interactive-preview.tsx` (Tailwind +
    Next.js conventions, used by the review modal).
  - Extension: `extension/src/tailored-resume-overlay-preview.tsx` (custom
    CSS sibling that paints highlights directly on a clean PDF render with
    no extra UI chrome — matches the iframe-based preview's layout so the
    toggle only adds highlights, no layout shift).
- Fix the worker URL once per shell. In the extension shell, after
  `pdfjs-dist/webpack.mjs` is dynamically imported (and assigns its broken
  Worker), terminate that worker and replace `GlobalWorkerOptions.workerPort`
  with a Worker built from `pdfjs-dist/build/pdf.worker.mjs?url`. Vite emits
  this as a reachable `/@fs/...` URL in dev and a hashed asset in prod.
- Do NOT add Tailwind to the extension just to make a "shared" component fit.
  Extension-side custom CSS (`extension/src/App.css` —
  `.tailored-preview-overlay-highlight*`) is the source of truth for the
  extension panel and stays decoupled from `app/globals.css`.

Rules:
- The extension panel and the web review modal have intentionally different
  visual chromes. A "shared" component must either: (a) ship zero UI chrome
  and zero Tailwind classes (rendering primitives only, host-styled), or
  (b) be duplicated. Don't re-export the web component verbatim into the
  extension and expect it to fit.
- Whenever a code path eventually calls `pdfjs.getDocument(...)` from the
  extension, verify the worker URL the extension dev server resolves to is
  reachable (HTTP 200), not just that imports compile. The bare
  `pdfjs-dist/webpack.mjs` import path silently 404s in crxjs+Vite dev.
- Tailwind v4's preflight is a global reset. Do not add `@import
  "tailwindcss"` to the extension without auditing every existing custom-CSS
  rule that depends on user-agent defaults. The extension's UI is built
  without preflight; flipping that on regresses the entire panel.
- Verify diff-highlighting changes by actually rendering a real PDF inside
  the extension's Vite dev origin (not just a build green or a type-check)
  and confirming a `.tailored-preview-overlay-highlight` overlay appears
  with non-empty CSS background. A green build + green types says nothing
  about whether highlights paint.
