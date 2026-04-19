Tailor Resume review optimistic edit toggle:

- Symptom: clicking `Original block` or `Tailored block` in the review modal could feel laggy because the selected state waited for the server round-trip and PDF recompilation to finish.
- Root cause: the UI derived the accepted choice entirely from the saved record, so the toggle visuals did not move until the PATCH response returned with the rebuilt preview metadata.
- Fix: keep a small client-side optimistic edit-state overlay in the review modal, drive the accepted/rejected UI from that overlay immediately, and clear it once the saved record catches up or the request fails.
- Guardrail: keep the optimistic state scoped to the review controls and edit badges only; the interactive PDF preview should continue to reflect the canonical saved render until the slower LaTeX/PDF pipeline finishes.
