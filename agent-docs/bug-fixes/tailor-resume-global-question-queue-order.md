Tailor Resume Step 2 manual ordering

- The global Step 2 question queue was removed because automatic ordering still generated stale first questions when `USER.md` changed between chats.
- After Step 1, each run that may need clarification becomes an independent `pending` start. The user chooses which card to generate first, and that click reads the latest `USER.md`.
- Sorting should keep ready chats first, then pending starts by creation time, then deciding items. This is display/order hygiene only; it must not imply automatic claiming or draining.
