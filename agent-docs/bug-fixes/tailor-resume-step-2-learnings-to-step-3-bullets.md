Tailor Resume Step 2 learnings into Step 3 bullet edits

- Bug: Step 2 could collect user-confirmed technology examples into `USER.md`, but Step 3 planning was too likely to satisfy the new keyword only through the skills section. Step 4 then followed that accepted plan and never converted the confirmed example into an experience bullet.
- Fix: pass the recent Step 2 questioning summary directly into Step 3 planning in addition to the updated `USER.md`, and make the planning prompt treat quoted technology bullets as strong candidates for experience-bullet swaps.
- Guardrail: Step 4 is intentionally segment-safe and cannot create an extra neighboring `\resumeitem`; adding a new bullet-shaped experience should be planned as replacing/swapping a weaker existing bullet in the matching experience. Whole-bullet removal remains supported by planning an empty `desiredPlainText` and having Step 4 return empty `latexCode` for that single segment.
