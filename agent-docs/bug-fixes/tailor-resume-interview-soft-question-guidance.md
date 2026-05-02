Tailor Resume interview soft question guidance

- Bug: Step 1 exposed `totalQuestionBudget` as a strict model-facing contract and server validation rule, so the interview could fail with `The model exceeded the declared interview question budget.` even when the follow-up itself was otherwise reasonable.
- Root cause: we treated a prompt preference about keeping the chat short as hard application state, persisted it in the questioning summary, surfaced it in UI counters, and rejected later tool calls that crossed that declared number.

Fix:

- Remove `totalQuestionBudget` from the interview tool schema, questioning summary, and UI.
- Keep only the asked-question count as lightweight context for future turns.
- Move the brevity guidance into the interview system prompt: ask one question at a time, keep the overall chat short, and finish as soon as the missing detail is clear.

Guardrail:

- If the interview starts failing because the model asked "too many" questions, prefer tightening the interview prompt before adding another hard numeric validator.
