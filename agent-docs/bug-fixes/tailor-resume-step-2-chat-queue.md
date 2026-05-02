Tailor Resume Step 2 chat queue

- Step 2 used to allow multiple simultaneous follow-up chats and generated questions immediately for each run. That made later questions stale because they were not based on the `USER.md` updates from earlier chats.
- Step 2 now stores queued interview decisions with internal statuses: `queued`, `deciding`, and `ready`. Only `ready` records are exposed as the active chat. Queued/deciding records surface as active generation with the run step summary `Chat Queued`.
- The first ready chat opens as a full-height extension side-panel surface. Extension-originated runs open the side panel when questions are ready.
- The model may request that the chat finish, but `USER.md` patches are stored on the pending interview and are only applied when the user presses Done. If the user keeps chatting, the pending patch is replaced by the later end-of-chat patch.
- After a chat finishes, the server drains the queue: it re-reads the latest `USER.md`, re-runs the Step 2 decision for the next queued run, and either asks a grouped technology question or skips directly into resume generation.
- Queued runs are durable wait states. Stale-run cleanup should not cancel a `RUNNING` run that still has a matching `queued` interview, and the extension background monitor should be the notification path for queued chats that become ready after the original generation request already returned.
- A ready chat is not enough proof that Step 2 worked. Step 3 must treat positive, technology-specific learnings as hard requirements for the targeted planned segments; otherwise the implementation model can save a final resume that still misses every term the user confirmed in chat. Negative learnings such as no direct experience with a product should remain exclusions.
