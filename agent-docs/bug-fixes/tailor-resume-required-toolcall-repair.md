Tailor Resume required tool-call repair

- Symptom: Step 3/Step 4 could fail and restart an entire attempt when the model returned final structured JSON before calling the required keyword/health-check tool.
- Root cause: the response loop treated a missing required tool call as an attempt-level failure even though the Responses thread still had the candidate JSON and could be corrected in place.
- Fix: when the first final response arrives before the required tool call, continue the same Responses thread with a user reminder that asks the model to call the required tool using the previous candidate changes. Only fail the attempt if the model exhausts the tool-round budget without complying.
- Guardrail: required tool calls remain mandatory; the repair path saves the current attempt, not the health-check requirement.
