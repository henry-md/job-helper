Extension Tailor Resume queued chat monitor

- Bug: when a run returned `Chat Queued`, the extension request was finished. If that queued run later became the ready Step 2 chat, there was no active extension request left to reopen the side panel.
- Fix: the background worker schedules a lightweight alarm-backed monitor while queued chats exist. Fresh Tailor state opens the side panel once per newly ready interview and clears the monitor when no queued chat remains.
- Follow-up bug: while a chat/run was active, the side panel could reload from the shared personal-info cache and miss the newest interview state, such as `completionRequestedAt` after the assistant asked the user to press Done.
- Follow-up fix: treat active Tailor generations and pending interviews as volatile cache entries. The extension background worker now forces a fresh personal-info read for those states, and also caps general personal-info cache age so a panel reload cannot keep using a pre-run snapshot.
- Second follow-up bug: a just-written volatile cache entry could still be under the freshness threshold when a queued run finished, so the database showed all runs completed while the side panel kept rendering a stale Step 2 card.
- Second follow-up fix: never serve cached volatile Tailor state just because it is sub-second fresh. If the cached payload contains active generation or pending interview state, refresh it before returning personal info.
- Third follow-up bug: parallel off-page runs could finish in the database and create saved resumes, while their local extension run registry entries still rendered active cards because only the current page's local run was cleared.
- Third follow-up fix: when fresh personal info contains a matching saved resume and no matching active generation or interview, clear the completed local run registry entry for any page, not just the current tab.
- Guardrail: any async server transition from queued to ready needs a background-side notification path; do not rely only on the original generation stream.
- Guardrail: caches that are safe for completed resumes are not automatically safe for active interview handoffs. While a run or interview is live, prefer fresh server state over cache reuse.
