Tailor Resume stream double-close:

- Symptom: a streamed Tailor Resume run could appear stuck on an early step in the extension while the backend logged `Invalid state: Controller is already closed`.
- Root cause: the NDJSON stream writer let `controller.enqueue(...)` / `controller.close()` throw when the stream had already been closed or canceled, and that transport error bubbled back into the tailoring pipeline as if the current Tailor Resume step had failed.
- Fix: use an idempotent NDJSON stream writer that swallows already-closed transport errors, so stream shutdown cannot masquerade as a planning/generation failure. The extension also clears live step state when a tailoring request ends in an error.
- Guardrail: stream transport lifecycle errors should stay in the stream layer; they should never be reinterpreted as pipeline-stage failures.
