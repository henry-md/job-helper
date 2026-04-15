Problem:
- The Tailor Resume `LaTeX source` panel showed dark "horns" at the top corners while a resume upload was in progress.

Cause:
- The loading state darkened only the inner rounded editor well.
- The outer panel shell kept its own contrasting background, so that shell color showed through around the child radius and looked like corner bleed.

Fix:
- Keep the loading blur scoped to the inner editor/preview well so section labels stay crisp.
- Add a non-blurring underlay behind the inner well's full bounding box while loading so the parent shell color cannot peek through the rounded corners.

Rule:
- When a rounded panel contains another rounded surface, do not blur the whole parent if only the inner content is busy.
- Keep headers/chrome outside the blur region, and if the parent has its own fill, add a matching underlay behind the inner child's bounding box so rounded-corner bleed cannot show through.
