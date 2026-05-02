Cross-surface sync:

- The web app and extension are separate clients over the same server data. They should not treat their own local UI state or extension `chrome.storage.local` as authoritative for applications or tailored resumes.
- Server truth is split across Prisma-backed application/tailoring metadata plus the file-backed Tailor Resume profile. Because linked deletes can touch both stores, freshness should be driven from one cheap shared invalidation signal rather than from client-local assumptions.

Sync model:

- Prisma stores one `UserSyncState` row per user with two shared counters:
  - `applicationsVersion`
  - `tailoringVersion`
- These counters are server-scoped, not client-scoped. The extension and web app both bump the same counters after successful mutations.
- Mutations should bump only the domains whose cross-surface display state changed:
  - application create/update/delete: bump `applicationsVersion`
  - tailored-resume create/edit/delete, run/interview lifecycle changes, or base-resume/profile changes that affect Tailor Resume displays: bump `tailoringVersion`
  - linked deletes that remove both an application and its tailored resumes: bump both

Polling contract:

- `GET /api/sync-state` returns only the latest version snapshot for the authenticated user.
- This endpoint should stay cheap: no profile hydration, no cleanup pass, no counts/lists, and no file-system work beyond ordinary auth/session resolution.
- Clients may poll this endpoint every second while visible.
- A version mismatch means "re-fetch the heavier data now"; a version match means "do nothing."

Client refresh behavior:

- The extension should poll `GET /api/sync-state` with its bearer-backed app session while the side panel is visible.
- The dashboard should poll `GET /api/sync-state` while the page is visible.
- When only `applicationsVersion` changes, refresh application summaries.
- When only `tailoringVersion` changes, refresh Tailor Resume state.
- When both change, refresh both domains.
- The extension's initial personal-info bootstrap can use one enriched `GET /api/tailor-resume` response for Tailor Resume state plus the small tracked-application summary it renders, as long as the high-frequency polling still targets only `GET /api/sync-state`.
- Extension background refresh fetches for `/api/sync-state`, `/api/tailor-resume`, and `/api/job-applications` should opt out of the browser HTTP cache (`cache: "no-store"`), otherwise archive/delete mutations can be persisted correctly on the server and then immediately overwritten in the side panel by a cached pre-mutation payload.
- Polling should not trigger overlapping full refreshes; clients should ignore ticks while a sync-state check or full reload is already in flight.
- Tailor Resume refreshes must include both saved profile state and server-side in-flight state. `GET /api/tailor-resume` returns `activeTailorings` for active generations and pending interviews, and both the extension and dashboard should render those directly instead of only rehydrating saved `profile.tailoredResumes`.
- Saved tailored resumes now include `archivedAt`. Both clients should derive `unarchived` vs `archived` views from the same synced `tailoredResumes` payload instead of inventing separate local stores or archive-only endpoints.
- Step-progress updates should also bump `tailoringVersion`, otherwise a client can miss long-running in-flight changes after the initial run-creation bump and stay visually stale until completion.
- The dashboard should avoid clobbering local Step 2 interview editing state on every tailoring refresh tick. Refresh `activeTailorings` eagerly, but only replace the saved profile-shaped workspace state when the profile payload itself materially changed.
- The extension's current-page shell should retire any transient local run as soon as synced server state shows a completed unarchived tailored resume for the same comparable job URL, even if the page's local URL variant differs from the saved tailored-resume URL.

Guardrails:

- Keep high-frequency polling pointed only at the tiny sync endpoint. Do not poll `GET /api/tailor-resume` or `GET /api/job-applications` every second.
- After an optimistic delete, keep the current extension snapshot interactive while the follow-up enriched refresh runs in the background; do not replace the whole Tailor surface with a blocking loading state before the next action can start.
- If a stale client tries to open a tailored resume that has already been deleted, the client should treat a not-found response as a signal to evict the stale local view and reload the latest server state.
- This design intentionally prefers cheap 1-second eventual consistency over websocket/session fanout complexity. If a future change needs lower-latency than that, add push on top of the same shared server versions instead of replacing the version model.
