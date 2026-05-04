Problem:
- Opening the tailored-resume review modal in the web app triggered two
  related symptoms: a Next.js hydration error overlay on first paint, and
  an infinite render loop when toggling diff highlighting off and clicking
  an edit row (the blue focus highlight kept re-applying / kept "deselecting"
  the underlying text).

Causes:

1. Unstable `highlightQueries` reference fed an infinite focus-recompute loop.
   - `tailored-resume-review-modal.tsx` passed
     `highlightQueries={isDiffHighlightingEnabled ? ... : []}` to
     `<TailoredResumeInteractivePreview/>`. Both branches returned a fresh
     `[]` literal on every render.
   - The shared component's highlight effect has `highlightQueries` in its
     deps:
     `useEffect(() => { setPageHighlightMatches(...); setFocusHighlightRects(...); },
      [focusMatchKey, focusQuery, highlightQueries, highlightSource]);`
   - New array identity each parent render → effect re-fires → setState →
     re-render → new `[]` → loop. Visible as the focus highlight pulsing /
     re-applying continuously when the user clicked an edit row with the
     diff toggle off.

2. Hydration mismatch from `typeof document` and `window.matchMedia` checks.
   - The modal's render path was gated on
     `if (typeof document === "undefined" || !record) return null;` and then
     called `createPortal(...)`. Server returned `null`; first client render
     (during hydration) returned a portal element. Even though portals
     target `document.body` and don't add to the parent's DOM children,
     React's hydration compares the returned React elements at that tree
     position — `null` vs `<Portal/>` is a structural mismatch.
   - Separately, `useState(() => typeof window !== "undefined" &&
     window.matchMedia("(min-width: 1280px)").matches)` produced `false` on
     the server but the real breakpoint match on the client, flipping the
     `orientation` prop on `ResizablePanelGroup` and changing classNames in
     the SSR'd HTML vs the first client render.
   - The hydration mismatch also amplified the loop: React forced a
     full client re-render to recover, which re-fired the unstable-`[]`
     effect chain.

Fix:
- Hoist a module-scoped `EMPTY_HIGHLIGHT_QUERIES: TailoredResumeInteractivePreviewQuery[] = []`
  and pass that stable reference instead of `[]` literals when the toggle is
  off OR when no queries are available. Single shared empty across renders =
  stable identity = effect deps don't trip.
- Add a `hasMounted` state initialized `false`, flipped to `true` in a
  `useEffect(() => { setHasMounted(true); }, [])`. Return `null` until
  mounted so server and first client render both return `null`; the portal
  appears on the second client render. This is the standard "client-only
  portal" pattern for SSR.
- Initialize `isWideLayout` to `false` on both server and client; the
  existing `useEffect` that subscribes to `window.matchMedia` syncs the real
  value after mount. The brief layout flash on wide screens is acceptable
  (and only happens once per modal open).

Rules:
- Never pass freshly-allocated array/object literals (`[]`, `{}`,
  `{ ... }`) directly as props to a child whose effect dependency array
  includes that prop. Either memoize (`useMemo`) or hoist a stable
  module-scoped constant for empty defaults.
- When porting a component to SSR (or wrapping one in
  `createPortal`/`typeof document` guards), the first client render must
  return the same React-element shape as the server. Use a `hasMounted`
  gate, not `typeof document` alone.
- Never read `window.matchMedia`, `window.innerWidth`, `navigator`,
  `localStorage`, etc. inside `useState`'s lazy initializer in a Client
  Component that is SSR'd by Next.js. Either subscribe via `useEffect`
  after mount, or use `useSyncExternalStore` with a server snapshot that
  matches the initial client snapshot.
- A hydration mismatch is not a cosmetic bug. React recovers by
  regenerating the entire mismatched subtree on the client, which can
  cascade into render loops downstream (especially through effects with
  unstable dependency arrays). Always treat them as load-bearing.
