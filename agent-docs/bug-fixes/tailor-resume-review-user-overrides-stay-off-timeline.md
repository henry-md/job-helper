Tailor Resume review user overrides stay on the same block record:

- Symptom: editing a tailored block manually created a new `User` entry in the review rail, and the selected diff could switch from the original-vs-model comparison to the user's custom text.
- Root cause: the stored edit model only had `before` and `after`, so user edits were appended as additional edit-history rows for the same `segmentId`.
- Fix: store one edit record per changed block with three parts: original `beforeLatexCode`, model `afterLatexCode`, and optional `customLatexCode`. The review rail stays keyed to that single block record, while the compiled PDF uses `customLatexCode` when present.
- Guardrail: preserve the model edit's `beforeLatexCode` and `afterLatexCode` as immutable review references, and clear `customLatexCode` when the user explicitly re-selects `Original block` or `Tailored block`.
