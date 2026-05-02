Tailor Resume page-count hard fail:

- Symptom: a tailored resume that exceeded the original page count could still be saved and shown in Preview because Step 5 failures were treated as a reviewable draft when a PDF buffer existed.
- Root cause: the route only hard-failed thrown page-count errors without also hard-failing Step 5 results that returned `validationError`, and the page-count failure helper preserved `success` when `previewPdf` was present.
- Fix: convert any Step 5 page-count failure into `generation_failure`, keep the failure message labeled as Step 4, and return a failure response instead of writing a tailored resume record/PDF.
- Guardrail: a compiled PDF is not enough for success. When the page-count guard is enabled, the accepted result must empirically fit within the target page count before it can be saved or offered for download.
