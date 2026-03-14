Problem:
- The dashboard intake form regressed because the outer editor panel was laid out as a 2-column grid while the compact field cluster inside it was also trying to manage its own 2-column layout.

Cause:
- Panel-level grid rules and inner field-grid rules were overlapping.
- Full-width sections, compact rows, and special-case controls were all participating in the same panel grid.
- That caused visible dead space on the right and made the field area look under-filled.

Fix:
- Make the outer editor panel a plain vertical layout (`flex-col`), not a responsive grid.
- Keep the compact field cluster as the only place that uses a 2-column grid.
- Let full-width sections live outside that grid in normal document flow.
- Keep special-case controls like `Salary range` on their own full-width row with their own internal layout.

Rule:
- Do not use a panel-level grid for this editor.
- Use one dedicated 2-column grid only for the compact field cluster.
- Let full-width sections live outside that grid.
