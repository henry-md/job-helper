Tailor Resume greedy LaTeX segmentation:

- Symptom: review cards showed one `segmentId` edit mutating an entire section, especially `TECHNICAL SKILLS`, even when the visible changes were really separate sibling blocks.
- Root cause 1: `readCommandAt(...)` kept consuming blank-line-separated `{...}` blocks as extra arguments to the previous command, so `\resumeSection{TECHNICAL SKILLS}` swallowed the following `{\\BodyFont ...}` blocks.
- Root cause 2: tailoring instructions allowed one `latexCode` replacement to contain multiple logical blocks, so the model could legally bundle sibling edits into one change.

Fix:

- Stop command argument parsing once a later `{...}` group is separated by a blank line.
- Segment top-level brace-wrapped content blocks as first-class chunks, so skills rows and similar blocks receive their own deterministic `segmentId`s.
- Reject model replacements that normalize into more than one logical block, and tell the model to return separate changes per chunk.

Guardrail:

- If the review UI ever shows a section-heading edit whose before/after LaTeX includes multiple sibling brace blocks, check `lib/tailor-resume-segmentation.ts` first before blaming the diff renderer.
