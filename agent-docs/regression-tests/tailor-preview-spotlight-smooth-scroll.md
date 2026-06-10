# Tailor Preview Spotlight Smooth Scroll

## Functionality to Preserve

The Tailor Resume interactive preview spotlight should track cursor movement smoothly, including when the cursor is inside the fixed spotlight overlay. Moving the cursor by a few pixels should continuously update the magnifier crop and position. The spotlight should remain stable during high-resolution image swaps and after clicking a segment to edit it.

The spotlight should also dismiss when the cursor is outside both the rendered PDF page and the spotlight area.

## Bugs That Tend to Recreate This

- Returning early from the page `pointermove` handler when the cursor is inside the fixed spotlight. That keeps hover state working but freezes the magnifier crop, causing dead zones followed by step changes.
- Updating only segment hover state from spotlight-space pointer events instead of recomputing `magnifierState`. The magnifier's own `onPointerMove` must not be hover-only; when the cursor is over the rendered PDF, it should use the same raw page-coordinate movement path as the page handler.
- Driving spotlight movement from the magnifier's already-transformed image coordinates while the cursor is still over the rendered PDF. That creates a feedback loop: reversing cursor direction can briefly accelerate the crop or make movement feel inverted. Use raw viewport-minus-page coordinates for movement, and reserve magnifier-space mapping for segment hit testing/clicking.
- Snapping vertical crop state to the nearest PDF text line instead of using the raw pointer-derived Y coordinate for the magnifier center.
- Computing spotlight zoom from the hovered line's short width rather than the stable full text-column width.
- Swapping to a high-resolution spotlight image before it has decoded, which can cause a brief blank frame.
- Letting guided edit focus re-run on image-source changes or clear a newer cursor-hover spotlight state after its timer fires.
- Clearing hover or spotlight state when leaving the PDF page into the spotlight, instead of dismissing only after the cursor is outside both regions.

## Focused Checks

Use these checks when touching `components/tailored-resume-interactive-preview.tsx`, `lib/tailor-resume-preview-focus.ts`, Tailor Resume segment hit testing, PDF preview rendering, high-resolution spotlight generation, edit-focus behavior, or nearby pointer/scroll handlers.

Do not run this for every unrelated feature. Skim this file when the touched area is close, then run the focused checks that match the change.

- Run the spotlight smoothness harness:
  `node /Users/Henry/.codex/skills/check/repos/job-helper-50474f3fb3e4/check-spotlight-smoothness.mjs`
- Expected smoothness result: `uniqueYPositionCount` should cover every sampled cursor step, and `zeroDeltaCount` should be `0`.
- Run the direction/speed harness when pointer plumbing changes:
  `node /Users/Henry/.codex/skills/check/repos/job-helper-50474f3fb3e4/check-spotlight-direction-speed.mjs`
- Expected direction/speed result: down and up sweeps should have `wrongDirectionCount: 0`, and `centerYPerPointer` should stay close to `1` rather than spiking above `2`.
- For edit-focus jitter, click a previously tailored PDF segment such as `software-projects.entry-3.bullet-3`, hold the cursor at several positions for about two seconds each, and capture rapid screenshots. Rect, background position, and background size should stay stable while the cursor is still.
- For dismissal, move from the rendered PDF into the spotlight and then outside both areas. The spotlight should stay visible in the first transition and disappear in the second.
