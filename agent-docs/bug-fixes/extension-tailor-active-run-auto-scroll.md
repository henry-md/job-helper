# Extension Tailor active-run auto-scroll

- Symptom: using `Go to tab` for a saved tailored resume opened the job tab and scrolled the Tailor panel to the matching resume row, but doing the same from an in-flight Tailor run could leave the active run card below the fold.
- Fix: give the current-page active Tailor run card its own scroll target and auto-scroll key, then apply the same Tailor tab / Unarchived filter reveal behavior used by completed tailored resumes.
- Guardrail: current-page highlighting and auto-scroll should cover both completed saved resumes and in-flight active runs; global Tailor data should still come from synced active Tailor state.
