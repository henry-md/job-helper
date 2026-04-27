## Tailor delete deadlock and stale extension cache

- Symptom: the extension could show ghost tailored resumes across reloads even when Henry's authoritative Tailor data was already empty, and deleting a saved tailored resume from the extension UI could appear to succeed optimistically while the real delete lagged or wedged.
- Root causes:
  - `GET /api/tailor-resume` used to run artifact cleanup on the hot read path before returning profile data. If that cleanup got stuck behind a profile lock, the extension could keep rendering cached Tailor data indefinitely.
  - `PATCH /api/tailor-resume` wrapped non-stream actions in `withTailorResumeProfileLock`, and the `deleteTailoredResume` action then called `deleteLinkedDashboardArtifacts`, which tried to acquire the same lock again. That self-deadlocked the completed-resume delete path.
  - The extension's personal-info cache could keep rendering stale Tailor slices after a sync-version change if the authoritative Tailor refresh stalled.
- Fix:
  - Removed artifact cleanup from `readTailorResumeResponseState()` so normal Tailor reads do not block on cleanup work.
  - Split linked-dashboard deletion into a lock-owning entrypoint and a `WithinLockedProfile` variant so the Tailor PATCH route can reuse the already-held profile state without nesting the same lock.
  - Switched the extension personal-info cache to version-aware invalidation for stale application/tailoring slices, and added request timeouts so tab reloads do not keep ghost Tailor rows alive when the authoritative refresh is unhealthy.
- Verification:
  - `deleteTailoredResume` now returns quickly and the authoritative Tailor API drops to zero after the UI delete flow.
  - A Henry-authenticated extension harness confirmed delete, reload, and injected stale-cache reload all end with zero tailored resumes and zero Tailor/application rows in Henry's account.
