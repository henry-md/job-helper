Extension Tailor Resume Step 2 action cards

- The old alarm-backed queued-chat monitor is obsolete. Step 2 no longer auto-promotes a waiting run after another chat finishes.
- Pending Step 2 starts are surfaced directly in `activeTailorings` as `pending_interview` records with `interviewStatus: "pending"`, and the side panel shows a `Start chat` card for each one.
- Once clicked, the server moves the marker to `deciding`, re-checks fresh `USER.md`, then either exposes a `ready` hard-coded keyword-review chat for `Answer` or skips into final tailoring. The LLM examples call happens later from the inline `Generate` action inside the chat.
- Volatile Tailor state still needs fresh personal-info reads. Do not serve stale cache entries while there are active generations or pending/ready interviews.
- Keyword badges should replay from fresh active tailoring state as well as live Step 1 stream events, because a pending Step 2 card can still carry scraped emphasized technologies.
