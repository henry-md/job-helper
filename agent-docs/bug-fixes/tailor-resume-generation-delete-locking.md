Tailor Resume generation and delete locking:

- Symptom: deleting a saved tailored resume could appear blocked until a separate `Create tailored resume` run finished.
- Root cause: the Tailor Resume API held the per-user `profile.json` mutation lock for the entire long-running tailoring request, so delete requests had to wait behind the OpenAI generation call even though they only needed a short profile update.
- Fix: keep the long tailoring generation outside the lock, snapshot the base-resume inputs up front, then re-acquire the lock only to merge the new tailored resume into the latest profile state. If the base resume changed in the meantime, discard the stale result and ask the user to rerun tailoring.
- Guardrail: when a request needs a long external call plus a short read-modify-write on shared state, lock only the shared-state sections and merge back into the newest snapshot so unrelated UI actions can stay responsive.
