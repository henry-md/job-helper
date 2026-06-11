Tailor Resume spotlight click target mismatch:

- Symptom: when the PDF spotlight/magnifier was active, the blue hover block could show one resume segment while clicking opened a different edit block; the rendered PDF could also show green segment-target boxes instead of relying on the blue hover layer.
- Cause: pointer and click resolution could fall through to the base rendered PDF coordinates underneath the fixed spotlight instead of resolving the segment under the magnified spotlight text.
- Fix: when the spotlight is active, let the magnifier receive pointer events, keep spotlight movement smooth by updating magnifier state from pointer motion, and resolve hover/click actions from the magnifier coordinate transform after that movement; keep segment target buttons visually transparent so they do not draw green boxes over the PDF.
- Unified spotlight regression check: verify these three behaviors together, in one spotlight-open run, because fixing one has repeatedly regressed another:
  1. Smooth scroll: moving the pointer within the spotlight should continue to update the magnifier background/viewport smoothly, including multi-step pointer movement.
  2. Spotlight hover targeting: the blue hover block must be based on what the cursor is over in the spotlight/magnified preview, not what sits underneath the cursor in the base rendered PDF.
  3. Spotlight click targeting: clicking must open the edit block for the same segment currently under the cursor in the spotlight, not any base-PDF segment underneath.
- Guardrail: the visible blue spotlight hover and the edit block opened by click must always refer to the same segment, especially when the spotlight overlaps a different base PDF line. Segment target hit areas should remain invisible; the blue hover/edit layers are the visible affordance. Do not fix click targeting by freezing spotlight movement.
