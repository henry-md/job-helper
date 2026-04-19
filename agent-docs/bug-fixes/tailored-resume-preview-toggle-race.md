Tailored resume preview toggle race:

- Symptom: toggling applied/rejected resume edits could intermittently knock the interactive PDF preview into a permanent error state even when the rebuilt LaTeX itself still compiled successfully.
- Root cause: the review flow rewrote `profile.json` and the tailored PDF in place, so the preview loader could occasionally observe a partially rewritten file during a toggle-driven refresh; the client also treated the first document-load miss as terminal instead of retrying a short-lived local failure.
- Fix: write resume profile and PDF artifacts atomically via temp-file rename, and let the interactive preview retry a couple of quick document-load failures before surfacing the error state.
- Guardrail: if a toggle bug appears to be “bad replacement LaTeX,” verify the rebuilt document combinations first; for this class of issue, a fully compilable state graph can still fail at the preview layer when readers race with file rewrites.
