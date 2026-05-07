Tailor Resume Step 2 soft model output

- Symptom: Step 2 example generation could fail a tailoring run because model-produced example cards violated local quality checks such as weak bullet phrasing, duplicate card text, or resume-placement suffix rules.
- Fix: Step 2 now treats model output quality as advisory. It preserves the assistant response, coerces malformed tool/text payloads into usable chat messages when possible, and falls back to deterministic technology cards instead of emitting failed step events.
- Guardrail: Step 2 response handling should surface hard failures only for OpenAI request/API failures. Content that is awkward, duplicated, incomplete, poorly formatted, missing USER.md edits, or backed by markdown patch operations that do not apply should stay in the chat so the user can correct it conversationally.
- Do not add validators, invalidation plumbing, schema-quality retries, "previous invalid response" feedback, or terminal failure branches for Step 2 chat responses. Normalize/coerce and continue.
