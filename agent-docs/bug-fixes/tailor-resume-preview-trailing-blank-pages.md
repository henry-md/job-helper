Tailor Resume preview trailing blank pages:

- Symptom: a one-page tailored resume could show a blank second page in the interactive/highlighted preview, pushing the real resume top out of view.
- Root cause: the preview renderers trusted `pdfDocument.numPages` and rendered every page reported by pdf.js, including trailing pages with no meaningful text.
- Fix: before rendering pages, inspect text content from the end of the PDF and render only through the last page with non-whitespace text. Preserve all pages when the whole document has no text so image-only or unusual PDFs are not accidentally hidden.
- Guardrail: post-layout preview renderers should trim only trailing blank pages; never drop middle pages or use highlight overlay pagination as the source of truth.
