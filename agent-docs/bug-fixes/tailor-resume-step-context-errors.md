Tailor Resume step-context errors:

- Symptom: Tailor Resume failures could surface raw validation text without saying whether the failure came from planning, follow-up questioning, block generation, or page-count compaction.
- Root cause: the shared backend returned validation strings verbatim, so the dashboard and extension had to show opaque messages with no pipeline-step context.
- Fix: normalize Tailor Resume failure text in the shared backend so generation errors and saved review issues are prefixed as `Step X: ...` before clients render them.
- Guardrail: when a pipeline stage fails, attach the step number at the server boundary instead of relying on each client surface to infer it later.
