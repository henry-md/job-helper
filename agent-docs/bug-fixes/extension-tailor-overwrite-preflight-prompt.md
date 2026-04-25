Extension Tailor Resume overwrite preflight prompt:

- Symptom: starting Tailor Resume from the extension could briefly show the live generation state before switching to an overwrite confirmation for the same job.
- Root cause: the extension only discovered overwrite conflicts after it had already published optimistic running UI and then received the PATCH conflict response.
- Fix: the side panel button and shortcut flow now preflight the current job page against the latest active-tailoring and saved-tailored-resume summaries, and they only enter the running state when no overwrite confirmation is needed. The server conflict response remains the fallback for races.
- Guardrail: if the extension can already infer that the current job would replace existing tailoring work, ask for confirmation before showing progress that implies generation has started.
