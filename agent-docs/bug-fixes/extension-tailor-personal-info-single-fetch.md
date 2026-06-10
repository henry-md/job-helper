Extension Tailor personal-info single fetch:

- Symptom: opening the extension Tailor tab or reconciling after deletes could sit on `Loading tailored resumes...` longer than necessary because the panel waited for both `/api/tailor-resume` and `/api/job-applications` before leaving the loading state.
- Root cause: the background `JOB_HELPER_PERSONAL_INFO` path stitched together one Tailor Resume fetch plus a second tracked-applications fetch, and delete flows kept the panel in a blocking refresh until that full reconciliation finished.
- Current fix: the background personal-info loader uses one Tailor-only `GET /api/tailor-resume` response. After optimistic deletes, keep the current extension snapshot visible and refresh that payload in the background instead of dropping the whole panel back to loading.
- Guardrail: if the extension already needs Tailor Resume state plus a small related summary, prefer one server-owned payload over multiple client-side fan-out reads, and do not tie optimistic delete responsiveness to the completion of the follow-up refresh.
