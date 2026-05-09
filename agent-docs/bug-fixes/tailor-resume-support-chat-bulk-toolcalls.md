## Tailor Resume support chat bulk tool calls

- Bug: multi-bullet resume support requests could consume the support chat's small tool-round budget on repeated list/measure/create calls, leaving no final assistant summary after the last tool result.
- Fix: keep a bounded tool budget, but raise it for support-chat workflows and add a batch resume-bullet support tool capped at 10 records. The batch tool performs rendered-line checks server-side, skips malformed or 3+ line bullets, saves valid records, and returns per-item results.
- Tool contract: single-bullet measurement/check tools should stay minimal: proposed `quote` plus `resumeExperienceId`. Do not ask the model for a `reason` or the current/source bullet text just to measure line count; replacement source text belongs to save/create flows.
- Guardrail: after tool rounds are exhausted, make one no-tools final-summary pass so the user sees what changed instead of the generic missing-summary fallback.
