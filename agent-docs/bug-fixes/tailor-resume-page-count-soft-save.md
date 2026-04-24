Tailor Resume page-count soft save:

- Symptom: Tailor Resume could return a hard generation error such as `No proposed compaction candidate reduced its block's measured rendered line count.` even though step 3 had already produced a valid tailored preview PDF.
- Root cause: the route treated step-4 page-count verification or compaction failures as `generation_failure`, so the API returned `422` instead of preserving the valid preview-bearing draft.
- Fix: when a previewable tailored draft already exists, keep that draft and surface the step-4 failure as `tailoredResumeError` for review instead of failing the whole run.
- Guardrail: page-count guard failures should only hard-fail when no previewable tailored draft exists yet.
