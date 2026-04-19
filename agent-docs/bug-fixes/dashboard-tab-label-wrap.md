Problem:
- The dashboard's segmented tab control could wrap the longer `Tailor Resume` label into two lines when the header had to share space with nearby actions.

Cause:
- The tab buttons kept `w-full` even on wider breakpoints, so the flex row shrank both pills more aggressively than their content needed.
- The label styling also left little room for the longer uppercase text once tracking was applied.

Fix:
- Keep full-width buttons only for the compact stacked/mobile layout.
- Switch the buttons back to content-width on `sm+`, tighten the compact text sizing/tracking a bit, and force single-line labels with `whitespace-nowrap`.

Rule:
- In shared header action rows, avoid `w-full` on pill buttons once the layout switches from a mobile grid/stack to an inline flex row.
- For short segmented controls, prefer slightly tighter tracking plus `whitespace-nowrap` over allowing a wrapped label.
