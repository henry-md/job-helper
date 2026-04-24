Tailor Resume interview finish confirmation

- Bug: Step 2 could end immediately when the model called `finish_tailor_resume_interview`, which gave the user no chance to add one last clarification after the model decided it had enough context.
- Fix: treat `finish_tailor_resume_interview` as a pending finish request first. Persist the finish toolcall on the interview thread, append a short assistant message, and keep Step 2 in a waiting state until the user explicitly presses `Done`.
- Guardrail: if the model edits `USER.md`, the user-facing question or completion message must explicitly say so, and the UI should expose the raw toolcall in the collapsible toolcall section for that message.
