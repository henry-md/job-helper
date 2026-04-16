Tailor Resume link precedence

This system has two different link-authority modes on purpose:

1. Source LaTeX editing mode
- File path: `PATCH /api/tailor-resume` with `latexCode`
- Meaning: the user is editing the saved LaTeX that represents their original/base resume.
- Rule: the user edits LaTeX first, then disabled/current links and Prisma-backed locked links are reconciled in a follow-up processing step after every LaTeX edit.
- Concretely:
  - Start from the normalized user-edited LaTeX.
  - Reparse the current LaTeX deterministically by scanning for explicit `\href{destination}{label}` links plus tracked plain-text occurrences for disabled/locked labels.
  - Rebuild the current parsed link list from that LaTeX scan.
  - Merge in stored locked links from Prisma by `key`, defaulting to the locked record on conflicts.
  - Keep stable keys based on visible labels plus occurrence order.
  - If the current LaTeX contains an explicit destination for a matching key, that destination updates the current parsed link record, but it does not overwrite the persisted lock row.
  - If a previously deleted link is reintroduced as an explicit `\href` in the source LaTeX, re-enable it in the current parsed link list.
  - If a locked label still appears as plain text in the source LaTeX, the derived processing step re-injects the stored locked URL.
  - Save the processed LaTeX back into `profile.latex.code`, so locked URLs visibly bounce back in the editor after save/reload.
  - Compile previews and tailoring inputs from `applyTailorResumeSourceLinkOverrides(...)`, which consumes `{ currentLinks, lockedLinks }`, injects locked URLs, and strips disabled links.

Concrete edit order after any LaTeX save:

1. Read the normalized user-edited LaTeX.
2. Parse links from the LaTeX.
3. Add stored locked links from Prisma and deduplicate by `key`, defaulting to the locked value on conflicts.
4. Re-run the derived source-link processing pass so any matching locked links are injected back into the saved/compiled LaTeX.
5. Save the processed LaTeX plus current parsed links to the file-backed profile; save only locked links to Prisma.

Locked upload preference

- A saved link can also be marked `locked`.
- Locked links mean “when a future uploaded resume or LaTeX edit contains this same visible label/key again, force that label back to this saved destination in the derived processing pass.”
- On fresh resume upload, only locked link mappings are seeded into extraction.
- Unlocked saved links should not override a newly uploaded source resume before the user reviews it.
- Locked mappings are not rewritten by ordinary LaTeX edits.
- Unlocking deletes the corresponding Prisma row immediately.
- If the saved LaTeX contains only plain text for that label, the next processing pass re-injects the locked destination before the document is saved again.

2. Resume generation / tailoring mode
- File paths: resume extraction and regeneration flows in `lib/tailor-resume-extraction.ts`
- Meaning: the app or model is generating a fresh resume draft for a job description using the saved base-resume context.
- Rule: saved original links are authoritative.
- Concretely:
  - Pass the merged current-link view plus persisted locked links into generation as known link context.
  - Apply saved link overrides onto generated LaTeX after the model returns.
  - When a generated draft includes a link with the same key as a persisted locked link, the locked mapping wins.
  - This prevents generated tailored resumes from drifting away from user-confirmed locked destinations.

Why this split exists

- When the user edits their own source LaTeX, they are intentionally editing the canonical original resume, so their explicit `\href` should win.
- When the system generates or regenerates a tailored resume, the model should not silently override the user-confirmed locked links.

Current implementation hooks

- Source-LaTeX-wins mode:
  - `app/api/tailor-resume/route.ts`
  - `lib/tailor-resume-profile-state.ts`
  - `lib/tailor-resume-locked-links.ts`
  - `extractTailorResumeTrackedLinks(...)`
  - `buildTailorResumeLinkRecords(..., { preferExtractedUrls: true, preserveUnusedExisting: false })`
  - `applyTailorResumeSourceLinkOverrides(...)`

- Saved-original-links-win mode:
  - `lib/tailor-resume-extraction.ts`
  - `buildTailorResumeLinkRecords(...)` default behavior
  - `applyTailorResumeLinkOverrides(...)`

Important constraint

- The deterministic LaTeX parser currently recognizes explicit `\href{...}{...}` links.
- Plain text URLs without `\href`, or alternative/custom link macros, are not treated as authoritative parsed links unless support is added intentionally.
