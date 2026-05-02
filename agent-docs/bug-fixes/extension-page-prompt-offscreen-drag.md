Extension page prompt offscreen drag:
- Symptom: draggable page prompts, such as the job-keyword coverage modal, could not be moved partly outside the viewport to make room for reading the underlying page.
- Root cause: each drag update clamped the fixed-position prompt to a full in-viewport rectangle using the prompt's rendered width and height.
- Fix: keep the initial stacked placement, but let explicit user drag positions write through directly so prompts can be parked partially off-screen.
