Tailor Resume unhandled backend failure propagation:

- Symptom: if a backend exception escaped after a tailoring run row was created, the run could stay `RUNNING` with the last visible step still marked as active, so the extension looked like it was generating forever.
- Root cause: retry-aware step events were persisted, but unhandled route-level failures skipped the explicit terminal run-status update that normally happens after retry exhaustion.
- Fix: wrap long-running generation/interview continuations after run creation, emit one final failed step using the latest known step, then mark the run `FAILED` and return a structured error payload. The extension preserves that final step in its local failed run record so retry exhaustion appears as failed generation instead of a stale timer.
- Guardrail: intermediate failed step events may still be retryable and should not end the run. Only the route-level terminal path should flip the run lifecycle to `FAILED`.
