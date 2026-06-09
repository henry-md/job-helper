Extension Tailor current-page stale local step

- Symptom: a current-page Tailor Resume card could show Step 1 running for a long time even though the server run row had advanced to Step 3 or Step 4.
- Root cause: the current-page card preferred the locally streamed run to avoid resetting live timers. If the local stream/storage fell behind, that stale Step 1 record shadowed the server-hydrated active-generation state.
- Fix: keep using local timing history, but prefer the server active-tailoring snapshot when it has failed, reached Step 2 review, or advanced to a later generation step than the local run.
- Guardrail: current-page local state may preserve timers, but it must not hide a later persisted backend step. When server and local disagree, compare step numbers before choosing the visible card.
