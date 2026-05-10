# Tailor Resume Step 3 intent-plan keyword gate

- Symptom: Step 3 could fail after two attempts with "plan still misses required high-priority keyword assignments" even though the planner now emits high-level block intent rather than final resume text.
- Root cause: the old Step 3 hard gate still treated every supported high-priority keyword as mandatory at planning time. That matched the older plaintext-replacement role, but it overconstrained the newer intent-only planner.
- Fix: keep `check_planned_keyword_assignments` as planner feedback and keep rejecting unrecognized target keywords, but do not fail Step 3 only because some high-priority terms remain unassigned. Step 4 still enforces actual implemented resume keyword coverage against the generated LaTeX.
- Guardrail: Step 3 should stay ambitious and pass target keywords forward, but final text coverage belongs to the implementation stage because only Step 4 writes resume wording.
- Follow-up: the self-check tool is advisory, not a liveness gate. If Step 3 returns valid final structured JSON without calling it, parse and validate that JSON directly; do not burn extra model rounds just to force the tool call.
