## Extension zero-document empty states regressed to plain placeholders

- Date: 2026-04-26
- Surface: extension Tailor, Archived, and Applications tabs

### What broke

The extension still had the animated Tailor empty-state CSS, but the ready-and-empty branches in `extension/src/App.tsx` had fallen back to plain placeholder paragraphs. That left the zero-count tabs visually blank again, especially in the side panel where the unused vertical space is very noticeable.

### Fix

Reintroduce the old empty-state SVG as a reusable `DocumentEmptyState` and render it only for loaded zero-document states:

- unarchived tailored resumes
- archived tailored resumes
- tracked applications

Keep loading, auth, and error states on the simpler text placeholders.

Also keep the loaded empty states out of the shared `snapshot-card` shell. If they get rendered inside the standard card wrapper again, the empty screen turns into a heavy black box instead of feeling baked into the side-panel background.

Treat the legacy current-page tailoring shell as part of the same unarchived bucket as active runs and finished resumes. The empty state should only render when all three are absent, and the unarchived count should never show `0` while that shell is visible.

On the Tailor tab, do not wrap the unarchived category itself in a `snapshot-card`. The tab already represents that category; only the individual unarchived items should render as cards over the panel background.

### Guardrail

If the empty-state message changes, keep the copy wrapping enabled in `extension/src/App.css`. The restored animation now supports multi-line messages and will clip on narrower extension widths if `white-space: nowrap` comes back.
