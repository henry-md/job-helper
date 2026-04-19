Problem:
- A signed-in dashboard can look fine on desktop but feel broken on phones when the page keeps a viewport-locked shell and then stacks multiple independently scrollable sections inside it.
- On mobile, this often shows up as lower sections looking clipped, partial cards at the bottom of the screen, or history rails that require awkward inner scrolling instead of normal page scrolling.

Cause:
- The outer shell kept `100dvh`/overflow-hidden behavior that was tuned for desktop side-by-side layouts.
- When the layout collapsed to a single column, those same fixed-height containers and nested `overflow-y-auto` regions turned into stacked scroll traps.

Fix:
- Let the signed-in shell fall back to normal document flow on phone widths.
- Keep the desktop fixed-height/independent-scroll behavior behind a wider-screen breakpoint where side-by-side panes actually exist.
- Reduce oversized mobile-only editor/preview minimum heights so the first meaningful actions stay closer to the top of the page.

Rule:
- If a protected workspace switches from columns on desktop to stacked sections on mobile, prefer one page scroll on mobile and reserve nested scroll regions for wider breakpoints.
