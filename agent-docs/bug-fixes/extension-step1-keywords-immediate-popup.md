Extension Step 1 keywords immediate popup

- Symptom: the in-page Job Keywords badge did not appear when Step 1 started or finished with no extracted keywords, making the side-panel action look broken.
- Root cause: the background Step 1 badge sender returned early for empty `emphasizedTechnologies`, and the content badge hid itself when the final renderable keyword list was empty.
- Fix: always send a Step 1 badge message. Use a loading state while Step 1 is still running, render keywords when present, and render an explicit empty state when a completed run has no concrete saved keywords.
- Guardrail: do not silently hide the keyword badge for Step 1 events. If the keyword list is not ready or is empty, the badge should still open with a visible state.
