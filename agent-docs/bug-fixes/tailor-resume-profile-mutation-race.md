Tailor Resume profile mutation race:

- Symptom: after saving a custom tailored-resume block, switching that block back to `Original` or `Tailored` could fail with `The tailored resume could not be found.`
- Root cause: Tailor Resume stores one `profile.json` per user, and overlapping review edits, autosaves, or preview-recovery requests could each read an older snapshot and then rewrite the whole file, dropping newer `tailoredResumes` entries.
- Fix: serialize Tailor Resume profile mutations per user so every request finishes its read-modify-write cycle before the next one starts; apply the same lock to preview recovery because it can also rewrite tailored-resume metadata.
- Guardrail: if a future bug looks like a “missing tailored resume” right after another Tailor Resume action completed, inspect concurrent writes before assuming the id lookup itself is broken.
