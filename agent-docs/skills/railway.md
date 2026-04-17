# /railway

Use this command only when the Railway-linked service has a failed deployment to investigate.

## What To Do

1. Connect to Railway and identify the exact failed deployment first.
   Use deployment-specific status and logs, not just the latest successful-looking output.
   If there is no failed Railway deployment, say so and stop.

2. Read the full logs for that failed deployment.
   Check build logs and deploy/runtime logs for the same deployment ID.
   Prefer full logs over filtered snippets when the failure stage is unclear.

3. Reproduce the failing step locally with the same command Railway uses.
   For this repo, prefer exact commands such as `pnpm install --frozen-lockfile --prefer-offline`, `pnpm run build`, and any relevant start/runtime checks.

4. Fix the issue locally with the smallest relevant change set.
   Leave unrelated work in the tree alone.
   If the failure reveals a repeatable project gotcha, add or update a short note under `agent-docs/bug-fixes/`.

5. Re-verify locally after the fix.
   Re-run the failing Railway command locally, then run any follow-up verification needed to confirm the deployment should pass.

6. Stage only the files relevant to this `/railway` task.
   First run `git restore --staged .`.
   Then use targeted `git add <path>` and `git add -p <path>` to stage only the Railway-fix changes from this chat.
   Do not commit or push.

## Constraints

- Do not use this command unless a failed Railway deployment exists.
- Always anchor the investigation to a specific failed deployment ID.
- Do not trust partial logs when Railway can provide deployment-specific full logs.
- Do not stage unrelated local edits.
- Do not commit anything yourself.

## Final Response

Report:
- the failed deployment ID and what actually failed
- the root cause
- what you changed
- what you verified locally
- which files were staged
- one suggested commit message
