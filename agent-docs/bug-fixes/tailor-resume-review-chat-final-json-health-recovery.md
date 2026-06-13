Tailor Resume review chat final JSON health recovery:

- Symptom: review chat could show "The model returned final JSON before a matching successful refinement health check" even after the model had made health-check tool calls, leaving the user's requested edit unsaved.
- Root cause: the safety gate compared the final JSON candidate to the last successful tool-checked candidate by exact canonical JSON. Small final-answer differences in reasons, ordering, or tool-call adherence could fail the match even when the final candidate itself was valid.
- Fix: keep the model-facing requirement, but when final JSON is parsed and the prior tool signature is missing or mismatched, run the same server-side refinement health check against that final candidate before retrying. Save the recovery check in the chat tool transcript so operators can see what happened.
- Guardrail: never skip rendered page-count or malformed-bullet validation for review-chat edits. Recovery is only allowed by applying the same deterministic health check to the exact final candidate.
