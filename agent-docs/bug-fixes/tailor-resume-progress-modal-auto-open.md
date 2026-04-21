Tailor Resume progress modal auto-open:

- Symptom: starting tailored-resume generation showed a clickable Sonner toast for the live pipeline view, but the progress modal itself stayed closed until the user manually opened it.
- Root cause: `startTailorResumeProgress(...)` reset the progress state and explicitly closed the modal before raising the toast, so generation always began in a hidden state.
- Fix: open the progress modal as part of the shared start helper so new tailoring runs and resumed follow-up runs immediately reveal the live step cards while keeping the toast available as a reopen affordance after manual close.
