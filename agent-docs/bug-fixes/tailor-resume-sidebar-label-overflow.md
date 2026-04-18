Problem:
- The Recent tailored resumes sidebar could let long saved names visually crowd the right-side timestamp and feel like the row was pushing past its bounds.

Cause:
- The sidebar reused the full saved `displayName`, which is often `Company - Role`, even though the company is already rendered again on the second line.
- The row's text column was not explicitly claiming the remaining flex width before truncation.

Fix:
- Format the sidebar label separately from the saved record name.
- Try a compact but readable version first by abbreviating long parenthetical phrases and common role words.
- If the combined `Company - Role` label is still too wide, fall back to the shortened role-only label because the company already appears underneath.
- Keep the full saved name available on hover.

Rule:
- In tight dashboard rails, do not render the full saved tailored-resume name verbatim when the company is already shown in a secondary line.
- Give the text column `flex-1`/`min-w-0`, then shorten the primary label before falling back to a hard truncate.
