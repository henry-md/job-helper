Tailor Resume legacy planning-result compatibility:

- Symptom: deep-linking back into older tailored resume reviews could show `0 resumes` even though `profile.json` still had saved tailored resume records on disk.
- Root cause: older tailored resume records were persisted before `planningResult` was added. The parser treated `planningResult` as required and dropped those records entirely on fresh server render.
- Fix: when a tailored resume record is otherwise valid and still has the top-level thesis/company/display metadata, rebuild a minimal `planningResult` with that metadata and an empty `changes` list instead of discarding the record.
- Guardrail: parser upgrades for persisted product state should prefer backward-compatible metadata recovery over silently deleting older records from the UI, especially when the missing field can be reconstructed without inventing new user-visible edits.
