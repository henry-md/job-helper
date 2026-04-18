Tailor Resume invalid-output soft save:

- Symptom: the tailoring flow could create a new history item with no block edits and no PDF preview, while showing an inline error such as `Replacement for segment ... spans multiple logical blocks.`
- Root cause: the model retry loop correctly rejected invalid block replacements, but after exhausting retries the API still saved a failed tailored-resume record even when no valid candidate had ever been applied.

Fix:

- Classify tailoring outcomes into `success`, `reviewable_failure`, and `generation_failure`.
- Treat exhausted parse/segment-validation failures as `generation_failure` and return an API error instead of saving a misleading tailored-resume history entry.
- Keep saving `reviewable_failure` drafts only when a real candidate LaTeX document exists but preview compilation still fails, since those drafts can still be inspected or repaired.

Guardrail:

- If Tailor Resume shows a history entry with no edits and no preview, check whether the generation path is incorrectly saving a `generation_failure` as a reviewable draft.
