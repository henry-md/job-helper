Extension keyword matrix stale replay reset

- Symptom: dragging Step 1 keyword chips into new skills-section/narrative/priority buckets could appear to work, then snap back a few seconds later.
- Root cause: the content script updated the visible badge optimistically, but later background badge replays could carry older emphasized-technology classifications. The content script treated every incoming badge payload as authoritative, so stale payloads visually overwrote the user's latest drag even after the backend save had persisted.
- Fix: remember same-page keyword classification overrides scoped by the badge dismissal identity, which prefers the normalized job URL. Before rendering any incoming keyword badge payload, apply those local overrides so delayed stale replays cannot undo the current page's latest user drag.
- Guardrail: extension keyword-matrix checks should include a stale badge replay after drag saves and then wait at least 10 seconds before asserting final chip placement.
