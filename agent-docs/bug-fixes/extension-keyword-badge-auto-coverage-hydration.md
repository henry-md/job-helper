Extension keyword badge auto coverage hydration

- Symptom: returning to a job page after tailoring completed could show the Job Keywords popup automatically, but chips used the uncolored classification styling until the user dismissed and manually re-opened the keywords.
- Root cause: the automatic tab badge refresh could resolve a completed tailoring snapshot before the saved tailored-resume summary had hydrated. That snapshot included emphasized keywords but not keyword coverage, so the content script had no base/new/neither matrix to color chips.
- Fix: include keyword coverage on completed tailoring state, parse it in the extension, and let the tab-badge resolver fall back to completed-tailoring coverage while still preferring the saved tailored-resume summary when available.
- Guardrail: completed keyword badges should carry coverage from either the saved resume row or the completed tailoring snapshot; manually re-showing keywords should not be the first path that receives coverage data.
