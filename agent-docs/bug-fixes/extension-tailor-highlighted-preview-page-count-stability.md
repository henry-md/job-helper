Extension Tailor highlighted preview page-count stability:

- Symptom: turning on diff highlighting in the extension preview could push a tight final line onto an extra page even though the clean tailored PDF still fit.
- Root cause: that mode was using a freshly recompiled LaTeX document with inline highlight macros. Even when the macros were breakable, they could still perturb line breaking enough to change pagination in dense resume sections.
- Failed intermediate attempt: server-generated highlighted page images fixed page-count drift, but the result looked too soft compared with the browser's normal PDF preview.
- Final fix: keep the clean compiled PDF as the layout source of truth, render that PDF locally in the extension with `pdf.js`, and paint diff overlays on top of the page canvas. This preserves page-count parity without switching the user to a blurry static-image preview.
- Guardrail: for pagination-sensitive highlighted previews, prefer post-layout overlays over recompiling highlighted LaTeX. Use raster page images only when the product explicitly accepts the quality tradeoff.
