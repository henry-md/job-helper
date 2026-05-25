Tailor Resume Step 4 first-tool-call failures:

- Symptom: Step 4 could fail on the first implementation attempt and then succeed on the next attempt with nearly the same inputs.
- Root cause: the implementation model sometimes returned final strict JSON before calling the required Step 4 health-check tool. The response loop only repaired the missing tool call when there was no output text, so premature-but-parseable JSON advanced to later validation and failed as an attempt-level retry.
- Fix: make Step 4's first OpenAI response tool-gated to `check_implemented_resume_keyword_coverage`, strengthen the system prompt's tool-call order contract, and repair premature final JSON in-place even when the model returned output text. Step 3 uses the same in-place repair rule for its required assignment check.
- Logging guardrail: invalid Step 4 replacement logs now include the Step 4 prompt, final JSON, system prompt, and tool-call transcript so future failures show whether the model skipped the health check, called it with bad arguments, or passed the tool and failed later validation.
