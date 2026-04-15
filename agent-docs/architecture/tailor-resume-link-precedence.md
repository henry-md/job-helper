Tailor Resume link precedence

This system has two different link-authority modes on purpose:

1. Source LaTeX editing mode
- File path: `PATCH /api/tailor-resume` with `latexCode`
- Meaning: the user is editing the saved LaTeX that represents their original/base resume.
- Rule: explicit links already present in that LaTeX are authoritative.
- Concretely:
  - Parse the current LaTeX deterministically by scanning for `\href{destination}{label}` entries.
  - Rebuild `profile.links` from those parsed links.
  - Keep stable keys based on visible labels/occurrence order.
  - If the current LaTeX contains an explicit destination for a matching key, that destination overrides the previously saved link mapping.
  - If a previously deleted link is reintroduced as an explicit `\href` in the source LaTeX, re-enable it and store the destination.
  - If a link disappears from the source LaTeX, it should also disappear from the current parsed link list for that source document.

2. Resume generation / tailoring mode
- File paths: resume extraction and regeneration flows in `lib/tailor-resume-extraction.ts`
- Meaning: the app or model is generating a fresh resume draft for a job description using the saved base-resume context.
- Rule: saved original links are authoritative.
- Concretely:
  - Pass saved `profile.links` into generation as known link context.
  - Apply saved link overrides onto generated LaTeX after the model returns.
  - When a generated draft includes a link with the same key as an existing saved original link, keep the saved mapping unless the user later edits the source LaTeX itself.
  - This prevents generated tailored resumes from drifting away from user-confirmed original destinations.

Why this split exists

- When the user edits their own source LaTeX, they are intentionally editing the canonical original resume, so their explicit `\href` should win.
- When the system generates or regenerates a tailored resume, the model should not silently override the user-confirmed original links.

Current implementation hooks

- Source-LaTeX-wins mode:
  - `app/api/tailor-resume/route.ts`
  - `buildTailorResumeLinkRecords(..., { preferExtractedUrls: true, preserveUnusedExisting: false })`

- Saved-original-links-win mode:
  - `lib/tailor-resume-extraction.ts`
  - `buildTailorResumeLinkRecords(...)` default behavior
  - `applyTailorResumeLinkOverrides(...)`

Important constraint

- The deterministic LaTeX parser currently recognizes explicit `\href{...}{...}` links.
- Plain text URLs without `\href`, or alternative/custom link macros, are not treated as authoritative parsed links unless support is added intentionally.
