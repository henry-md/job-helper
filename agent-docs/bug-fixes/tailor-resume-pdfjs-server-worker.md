Problem:
- Tailor Resume could fail after a valid tailored PDF was already generated because the server-side PDF snapshot helper crashed with `Setting up fake worker failed`.

Cause:
- `pdfjs-dist` falls back to a fake-worker path on the server.
- In Next.js dev/server bundles, that fallback tried to dynamically import an internal `pdf.worker.mjs` chunk path that was not present where `pdfjs` expected it.
- The page-count verification stage depends on that same snapshot helper, so the worker bootstrap error surfaced as a tailoring failure instead of a normal resume review flow.

Fix:
- Preload `pdfjs-dist/legacy/build/pdf.worker.mjs` in the server snapshot helper and assign it to `globalThis.pdfjsWorker` before opening PDFs.
- This uses the fake-worker hook that `pdfjs` already checks, so it no longer tries to import a bundler-specific worker chunk path at runtime.
- Add a regression test that compiles the example resume, counts its pages, and renders preview snapshots through the same helper.

Rule:
- When `pdfjs-dist` runs in a server-only Next.js module, do not rely on its internal runtime worker-path resolution.
- Preload the worker module explicitly so page counting and preview snapshot generation stay independent of framework chunk layout.
