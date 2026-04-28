Extension Tailor Resume overwrite preflight prompt:

- Symptom: starting Tailor Resume from the extension could briefly show the live generation state before switching to an overwrite confirmation for the same job.
- Root cause: the extension only discovered overwrite conflicts after it had already published optimistic running UI and then received the PATCH conflict response.
- Fix: the side panel button and shortcut flow now preflight the current job page against the latest active-tailoring and saved-tailored-resume summaries, and they only enter the running state when no overwrite confirmation is needed. The server conflict response remains the fallback for races.
- Follow-up bug: the overwrite preflight could still fail open when the live summary refresh stalled or missed the current page, which let a duplicate preparation shell appear for an already-saved job.
- Follow-up fix: use the background-owned personal-info cache as the first overwrite source, only trust a no-match result after a live refresh succeeds, and refresh the panel snapshot again when prompt/run/preparation storage changes so current-page prompt binding can catch up.
- Guardrail: if the extension can already infer that the current job would replace existing tailoring work, ask for confirmation before showing progress that implies generation has started.
