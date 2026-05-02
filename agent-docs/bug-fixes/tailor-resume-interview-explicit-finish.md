Tailor Resume interview explicit finish

- Bug: Step 1 could emit a successful progress event when the server had only prepared a follow-up question, so the loading UI briefly implied the clarification step was complete before opening the chat.
- Bug: the interview model could end an active chat through the ordinary structured response path after one user answer, even when the user asked for another assistant response such as a sample bullet.
- Fix: when another question is ready, keep Step 1 in the running/current state until user input resolves it. Treat ending an active interview as an explicit `finish_tailor_resume_interview` tool call, and reject finishing when the latest user answer asks for a sample, draft, review, or clarification.
- Guardrail: do not convert post-start `skip` into `done`; `skip` is only for deciding not to start an interview at all.
