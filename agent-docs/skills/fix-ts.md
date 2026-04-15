# /fix-ts

Use this skill for a thorough TypeScript cleanup pass.

What it does:
- Find and fix compiler errors first.
- Then fix egregious lint issues when the clean fix is straightforward and improves the code.
- Group related errors by root cause so one good fix can clear multiple failures.

Suggested workflow:
1. Review the relevant project docs, especially `agent-docs/coding-conventions.md`, `agent-docs/general-directions.md`, and `agent-docs/bug-fixes/railway-build-extension-typecheck.md`.
2. Run `pnpm exec tsc --noEmit` and `pnpm exec eslint .` to find the current failures.
3. Search broadly before patching with `rg` so you understand whether the issue is local or shared.
4. Fix types at the source when possible instead of adding casts at the usage site.
5. After changes, rerun lint and finish with `pnpm run build`.

Important constraints:
- Do not create spaghetti code just to satisfy lint.
- If a lint fix needs excessive extra code for little benefit, skip it and explain why.
- Prefer shared types and small clean refactors over `any`, broad assertions, or repeated one-off patches.
- Keep the root Next.js TypeScript project isolated from the separate `extension/` toolchain.
- Never edit generated Prisma code or existing Prisma migrations.
- Do not commit anything unless the user explicitly asks.
