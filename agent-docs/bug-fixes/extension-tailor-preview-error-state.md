Extension Tailor preview error state:

- Symptom: older page-count-failed tailored drafts could still look like ordinary completed previews when a historical PDF existed.
- Root cause: the extension preview did not mirror the web review modal's failed-generation warning.
- Fix: show a visible failed-generation banner for saved tailored-resume records with an error, while leaving successful PDFs to use the browser/PDF viewer toolbar.
- Guardrail: do not add duplicate product-level download controls around the tailored preview. The PDF viewer toolbar is the download affordance for successful clean previews.
