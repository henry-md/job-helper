Tailor Resume Step 2 manual chat start

- The old Step 2 queue was removed. After Step 1, a run stores a `pending` interview marker only when deterministic keyword presence finds scraped technologies missing from both the resume and `USER.md`.
- The extension renders pending markers as `Start chat` action cards. Multiple runs may show that action at the same time; clicking one starts only that run's Step 2 review.
- Visual state matters: green `Start chat`/`Starting...` cards mean no chat has been opened yet, while the purple `Answer` treatment is reserved for an active chat backed by a ready interview conversation.
- The click is important: `startTailorResumeInterview` re-reads the latest `USER.md` before opening the chat. If no uncovered keywords remain, it skips Step 2; otherwise it persists the hard-coded scraped-technologies message and does not call OpenAI.
- The first true Step 2 LLM call happens only after the user clicks the inline `Generate` action on that first message. That streamed examples response becomes the second assistant message.
- The final `startTailorResumeInterview` payload may include other active interviews. Only auto-open the returned interview if it matches the clicked run/card; do not fall back to an unrelated `profile.tailoringInterview`.
- Internal interview statuses are now `pending`, `deciding`, and `ready`. `pending` means waiting for the user to start the chat, `deciding` means the start/skip transition is in flight, and `ready` means the side panel can render an `Answer` chat.
- Extension local `needs_input` run records are only stream fallbacks. They must not shadow server `pending_interview` records, or the side panel will hang on `Clarify missing details...` with no `Start chat` button.
- There is no server queue drain and no extension alarm monitor. Stopping/deleting a pending Step 2 run should remove only that run/interview; other pending cards remain independently actionable.
- A ready chat is not enough proof that Step 2 worked. Step 4 must treat positive, technology-specific learnings as hard requirements for the targeted planned segments; negative learnings such as no direct experience with a product should remain exclusions.
