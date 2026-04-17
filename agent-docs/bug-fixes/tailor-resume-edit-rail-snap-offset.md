Problem:
- The Tailor Resume review timeline could jump a few pixels to the right after being scrolled fully left, which also turned on the left edge fade and made the first card look blurred.

Cause:
- The horizontal edit rail uses `snap-start` cards inside a track with horizontal padding (`px-2`).
- Without matching `scroll-padding`, the browser treated the first snap point as being offset from the real left edge and settled the rail a few pixels right of `scrollLeft = 0`.

Fix:
- Keep the visual edge padding on the rail content, but add matching inline `scroll-padding` on the scroll container so the padded edge still counts as the snapport boundary.

Rule:
- When a snapping rail has leading or trailing track padding, pair that padding with matching `scroll-padding` on the scroll container or edge snaps can drift and trigger false “can scroll” UI states.
