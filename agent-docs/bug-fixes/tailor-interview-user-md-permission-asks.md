Tailor Resume Step 2 asked permission to save obvious USER.md memory

- Bug: After the user answered Step 2 with quoted bullets, employer/project mappings, or skills-only constraints, the model sometimes called `initiate_tailor_resume_probing_questions` to ask "do you want me to..." or "should I proceed..." instead of saving USER.md memory.
- Impact: The chat made users re-confirm the only thing Step 2 exists to do, and it could stall tailoring after the user had already supplied enough durable context.
- Current fix: If the model includes USER.md edits with a timid permission ask, normalize the turn to `finish_tailor_resume_interview`. If it asks permission without edits, preserve the visible question rather than invalidating the Step 2 chat response. The prompt still says paragraphs, quoted bullets, employer/project mappings, and skills-only constraints are explicit authorization to save memory now.
