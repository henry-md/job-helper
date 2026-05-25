Tailor Resume step timeouts and token caps:

- Symptom: extension Tailor Resume runs could sit on Step 1 keyword scraping for 15+ minutes, making the active run list look hung while the backend waited on a model request.
- Root cause: later tailoring stages used the shared step timeout helper, but Step 1 keyword extraction called the model without an abort signal or explicit output cap.
- Fix: Step 1 now uses the same per-request abort path as the model-backed tailoring stages, falls back to deterministic keyword hints if the model request times out, and writes the failed step event to durable Tailor Resume debug logs before continuing. Model-backed tailoring requests also send explicit output-token caps.
- Guardrail: every external model request in the Tailor Resume pipeline should have both an output-token cap and an abort signal. Retry attempts should get their own timeout window so a second transient retry is not instantly killed by the first attempt's elapsed time.

Stale active-run cleanup follow-up:

- Debug inspection found old `RUNNING` rows whose Step 2 interview state was already `ready`. A `ready` interview is waiting for user review, not live backend work, so a stale `RUNNING` row in that state should expire instead of being protected forever.
- Keep stale-cleanup exemptions for `pending` and `deciding` Step 2 interviews because those can represent real in-progress question setup or blocker reevaluation. Do not exempt stale `RUNNING` rows just because their matching interview is `ready`.
