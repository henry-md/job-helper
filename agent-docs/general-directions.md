MOST IMPORTANT THING: NEVER make a commit unless I give you my explicit permission. Suggest a git message, and I will either approve the message, give you an alternative message, or deny the commit. In your commit messages, use syntax like 'feat: ...', 'style: ...' or alternatively 'feat(Part): ...' or 'style(Part) ...' etc. if it was in a particular place.

Never deploy to Railway directly. Railway is synced to the git repo. We should only be deploying from git commits, and remember NEVER to do this without my explicit permission as given by the above.

Before you consider any task done, no matter how minor, run `pnpm run build` and make sure it passes. This is the required final verification step.

After you make any sort of change, run a linting error to make sure you didn't just create any compiler errors or eggregious linter errors (some small amt of linter errors are sometimes ok but we should try to avoid them).

Migration safety:
- Treat existing Prisma migration files as immutable project history. Never delete or edit files inside `prisma/migrations/` after they exist.
- If migration history is inconsistent, stop and surface the issue instead of trying to repair it by changing old migration files yourself.
- Never delete, rename, rewrite, or otherwise modify an existing file under `prisma/migrations/`, even if a migration seems broken or out of sync.
- If `npx prisma migrate dev --name <migration_name>` fails because of migration drift, a modified migration, or a reset prompt, stop immediately. Do not create a workaround by editing/deleting migration files; explain the problem and ask the user what they want to run.
- Creating a brand-new migration the right way with `npx prisma migrate dev --name <migration_name>` is allowed once per change when schema work is actually needed.

UI content:
Do not include developer-facing implementation details in the product UI. Avoid sidebars, helper copy, or labels that tell the user about required env vars, API routing, auth wiring, or other setup details the end user does not need.

Local runtime:
- Do not leave `next dev` or any other long-running local server/process running at the end of a task unless the user explicitly asks for it.
- If you start a local server for verification, stop it before handing control back to the user so they can run it themselves.
- Do not "pause" a local server with signals like `SIGSTOP` as a handoff mechanism; fully stop it instead unless the user explicitly asks for a pause.
