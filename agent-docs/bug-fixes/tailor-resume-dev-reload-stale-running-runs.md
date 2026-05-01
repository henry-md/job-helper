Tailor Resume dev-reload stale running runs:

- Symptom: the extension could show several Tailor Resume runs loading for 15+ minutes even though no backend worker was still processing them.
- Root cause: a dev-server restart or extension background reload can interrupt the streaming request after the run row is created but before the route writes a terminal `FAILED`, `CANCELLED`, or `SUCCEEDED` status. The extension then rehydrates those `RUNNING` rows from `GET /api/tailor-resume` as if they are live.
- Fix: active generation routes now heartbeat their run row while the backend process is alive, and `GET /api/tailor-resume` runs stale-artifact cleanup before returning active Tailor state. Expired run rows are marked `CANCELLED` instead of deleting their linked job applications.
- Guardrail: persisted run status needs a process-liveness signal. Cleanup should remove stale live shells without destroying user-visible application records just because a dev reload interrupted generation.
