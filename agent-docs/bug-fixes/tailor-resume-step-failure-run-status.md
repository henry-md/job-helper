Tailor Resume step-failure run status:

- Symptom: a long tailoring run could reach step 4, emit a final failed compaction step event, and then return a stale-run `409` saying the run was canceled or overwritten before it finished.
- Root cause: persisting a step event with `status: "failed"` immediately flipped the whole `TailorResumeRun` row to `FAILED`, so the later save guard no longer considered the still-live request active.
- Fix: keep the run row itself in `RUNNING` while persisting step-level failure details, and let the route set the terminal run status explicitly once it knows whether the overall request actually failed, needs input, or soft-saved a reviewable draft.
- Guardrail: step-level failure state and overall run lifecycle state are different; do not let an intermediate step event decide the final run status on its own.
