Problem:
- The Tailor Resume `LaTeX source` panel showed dark "horns" at the top corners while a resume upload was in progress.

Cause:
- The loading state darkened only the inner rounded editor well.
- The outer panel shell kept its own contrasting background, so that shell color showed through around the child radius and looked like corner bleed.

Fix:
- Mount busy overlays on the full panel surface, not only on the inner well.
- Keep the rounded overlay radius aligned with the panel shell so the whole panel darkens as one surface during upload/save states.

Rule:
- When a rounded panel contains another rounded surface, do not attach a full-surface loading tint only to the inner child if the parent has its own fill.
- Either let one rounded surface own the visible background, or apply the busy overlay to the full parent panel so the parent fill cannot peek through the child corners.
