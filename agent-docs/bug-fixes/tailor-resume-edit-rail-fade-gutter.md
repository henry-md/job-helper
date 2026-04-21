Problem:
- The Tailor Resume review edit rail could snap the currently selected edit card flush against the left edge while the edge fade was visible, causing the fade overlay to touch or dim the active card.

Cause:
- The rail used a left/right fade overlay that was wider than the rail content padding and scroll-padding. Programmatic `scrollIntoView({ inline: "start" })` therefore aligned the selected card under the fade zone.
- A later attempt fixed middle-card centering by swapping the rail's real content padding when selection moved off the first card. That made the first-to-second transition visually jitter because the content layout changed at the same time as the smooth scroll.

Fix:
- Keep the rail content padding stable and small at all times so the first card naturally starts at `scrollLeft = 0`.
- Do not rely on CSS scroll snap for the centered middle-card composition. Compute the target scroll position from the rendered rail/card geometry: first item scrolls to `0`, middle items center the selected card plus the next card, and the last item can center with the previous card.

Rule:
- When a horizontal rail has edge fades and intentionally shows neighboring items, prefer stable content geometry plus explicit programmatic scroll targets over changing track padding in response to selection.
- Edge selections may need different composition than middle selections; let browser scroll clamping handle the first item when possible instead of toggling layout classes.
