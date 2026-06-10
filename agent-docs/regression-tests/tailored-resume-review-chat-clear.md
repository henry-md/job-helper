Tailored resume review chat clear:

- Clearing a tailored-resume AI review chat must remove persisted chat messages without deleting the tailored resume's block edits, versions, PDFs, or artifact record.
- Keep an empty `TailorResumeChatThread` for the `tailored-resume-review:<profileRecordId>` key after clearing. If the thread is deleted entirely, hydration falls back to legacy `versions[].userPrompt` / `versions[].assistantMessage` and the chat appears to repopulate.
- Focused check: clear a review chat that has at least one refinement version, refresh the review UI, and confirm the chat is empty while the edit blocks and diff/version controls remain available.
