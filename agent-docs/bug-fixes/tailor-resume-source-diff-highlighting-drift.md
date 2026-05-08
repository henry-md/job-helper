## Source resume diff highlighting must share review diff cells

- Symptom: the Config source-resume editor could show blank colored pills, hide removed text in the original pane, or drift highlights onto the wrong edited line after source edits changed the line count.
- Cause: the source editor used a copied diff renderer instead of `TailoredResumeDiffCell`. That copy made changed spans transparent even in the read-only original pane and rendered deleted-line placeholders inside the editable textarea overlay, so the overlay no longer matched the actual draft text.
- Fix: source editing now uses the shared review diff cell and shared scroll-sync utilities. The edited textarea overlay renders only real draft lines, while one-sided row tone mapping follows the tailored-review panes.
- Guardrail: keep the native textarea overlay line-for-line with `draftLatexCode`; do not add virtual deleted rows to that overlay. If side-by-side alignment needs more precision later, improve the shared scroll-sync mapping instead of forking the diff cell painter again.
