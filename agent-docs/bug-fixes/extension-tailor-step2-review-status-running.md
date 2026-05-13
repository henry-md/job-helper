Tailor Resume Step 2 review gate stuck as running

- Symptom: parallel Tailor Resume cards reached Step 2 with copy like "Review classified keywords" but kept showing the loading "Clarify missing details..." state instead of an actionable review/play state.
- Root cause: the route marked the run `NEEDS_INPUT` before writing the final Step 2 review-gate step event. The generic step-event writer always stores `RUNNING`, so it immediately reverted the run status. Existing affected rows can therefore appear as `RUNNING` even though the step detail says the run is waiting for review.
- Fix: write the Step 2 review-gate step event first, then mark the run `NEEDS_INPUT`. The extension also treats Step 2 active-generation records with review-gate wording as ready so already-stuck rows render as actionable cards after rebuild.
