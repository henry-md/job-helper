## Tailored review source edits must stay block-scoped

- Symptom: applying "Edit Source Resume" from a tailored-resume review could behave like a whole-resume replacement when the stored replacement payload was broader than the selected block.
- Fix: the source-edit helper now resolves the replacement down to the selected `segmentId` before writing to the saved source LaTeX. If a full tailored document reaches this path, only the matching segment is extracted and applied.
- Guardrail: this action should never replace the saved resume record, filename, or tailored-resume display name. It should update only `latex.code` / `annotatedLatex` for the selected source block plus derived link/preview state.
