Tailor Resume queued chat stale cleanup

- Bug: Step 2 queued runs could be cancelled by stale-run cleanup while they were intentionally waiting behind another active follow-up chat. Their original request had already returned `Chat Queued`, so no run heartbeat was active.
- Fix: cleanup now treats a `RUNNING` run with a matching `queued` interview as live, removes orphan interview markers whose DB run is no longer active, and starts a heartbeat when a queued run is later drained and re-evaluated.
- Guardrail: queued Step 2 interviews are durable wait states, not stale work. Only terminal/orphan markers should be cleaned up automatically.
