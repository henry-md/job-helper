# Extension Tailor Covered URL Auto-Scroll

- Symptom: when the side panel was already open and Chrome navigated to a job URL with a saved tailored resume, the matching row was highlighted but could remain below the fold.
- Fix: when the active tab resolves to an unarchived completed tailored resume, switch the panel to the Tailor tab, show the unarchived list, and scroll the highlighted row into view once for that page/resume match.
- Guardrail: current-page row highlighting may depend on the active tab, but saved-resume data must still come from synced Tailor Resume state.
