Tailor Resume invalid artifact cleanup:

- Symptom: canceling or interrupting Tailor Resume could leave behind a broken saved card or a stale "live" run that the extension kept surfacing later.
- Root cause: some abandoned artifacts were still structurally present enough to hydrate UI state even though they had no usable preview/edit payload or no longer had matching live interview state.
- Fix: prune invalid saved tailored resumes on read when they have neither edits nor a compiled preview, delete their linked application/screenshots at the same time, and treat active run rows as stale when they lose required interview state or sit in `RUNNING` too long without progressing.
- UI follow-up: keep the Tailor Resume overflow menu visible on every card state and keep `Delete` in that menu even while a run is active. When a user deletes an in-flight run, cancel the local request, ask the background worker to stop the backend run, then purge the associated resume/application artifacts so the run cannot rehydrate itself.
- Guardrail: if the extension rehydrates Tailor Resume state from persisted backend artifacts, clean obviously broken leftovers before returning them so the side panel only renders reviewable drafts or truly live runs.
