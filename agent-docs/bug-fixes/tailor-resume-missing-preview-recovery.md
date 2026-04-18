Tailor Resume missing preview recovery:

- Symptom: opening a saved tailored-resume review modal could show “This tailored resume does not have a compiled PDF preview yet” even though the product should either display the PDF or explain the real compile failure.
- Root cause: the client only built preview URLs when `pdfUpdatedAt` already existed, so reopening a failed-or-missing preview never hit the preview route. The preview route also only read stored PDF files and did not recompile tailored resumes when the file or timestamp was missing.
- Fix: keep tailored preview URLs addressable even when `pdfUpdatedAt` is null, trigger an automatic preview recovery attempt when the review modal opens without a compiled PDF, and let the preview route recompile and persist the tailored PDF as a fallback when metadata is stale or the file is gone.
- Guardrail: if recompilation still fails, surface the actual LaTeX error in the review modal instead of a generic “no preview yet” message so the user can tell the difference between “missing file” and “invalid LaTeX”.
