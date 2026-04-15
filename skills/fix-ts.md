# /fix-ts

Use this skill when the goal is to do a thorough TypeScript cleanup pass: find and fix compiler errors, then fix egregious linting problems without turning the code into spaghetti just to satisfy rules.

## Read first

Refresh the local rules before editing:

- `agent-docs/coding-conventions.md`
- `agent-docs/general-directions.md`
- `agent-docs/system.md`
- `agent-docs/architecture/overview.md`
- `agent-docs/bug-fixes/railway-build-extension-typecheck.md`

## Scope and quality bar

- Fix compiler errors first. They are the primary goal.
- Then fix lint errors that are clearly harmful, noisy, or indicative of poor practice.
- Do not add layers of ceremony, placeholder objects, or awkward wrapper code purely to appease lint.
- If a lint fix would require disproportionate code for little real quality benefit, skip it and say why.
- If the code is already truly messy, prefer a small clean refactor over piling on more exceptions.
- Preserve project boundaries: server-side session/data work stays on the server; interactive form/upload logic stays in client components.
- Reuse existing shared types, especially `lib/job-application-types.ts`, instead of redefining shapes.
- Never edit generated code under `generated/prisma/`.
- Never touch existing Prisma migrations. If schema work is somehow required, stop and follow `agent-docs/coding-conventions.md`.

## Discovery workflow

1. Inspect the current tooling if needed:
   - `package.json`
   - `tsconfig.json`
   - `eslint.config.mjs`
2. Run a broad compiler pass:
   - `pnpm exec tsc --noEmit`
3. Run lint for the repo:
   - `pnpm exec eslint .`
4. Search broadly before patching:
   - `rg --files -g '*.ts' -g '*.tsx' -g '*.mts'`
   - `rg -n "eslint-disable|@ts-expect-error|as any|TODO|FIXME" .`
5. Group failures by root cause so one good fix can remove multiple errors.

## Fixing guidance

- Prefer fixing bad types at the source over adding casts at the use site.
- Avoid `any`, `unknown as X`, and non-null assertions unless they are clearly justified and locally safe.
- Prefer narrowing, explicit return types, shared helper types, and small helper functions over wide assertions.
- If multiple files repeat the same broken assumption, fix the shared utility or shared type instead of patching each call site.
- Keep user-facing copy product-focused. Do not add developer setup guidance to the UI.
- Keep screenshot validation aligned across client and server if a fix touches uploads.
- If extraction shapes change, update the schema, parser, shared types, and save path together.

## Repo-specific gotchas

- Final verification must include `pnpm run build`, even for small fixes.
- Also rerun lint after changes so you do not leave behind new compiler or egregious lint issues.
- The root Next.js TypeScript project must stay isolated from the separate `extension/` toolchain. If typechecking starts reaching into `extension/`, fix the config boundary rather than installing or importing extension-only tooling into the app.
- Do not commit anything unless the user explicitly asks. Still suggest a concise commit message in the final response.

## Stopping rules

- If build or type errors are caused by missing env vars, external services, or migration drift, report the blocker clearly instead of guessing.
- If the remaining lint errors are low-value and the clean fix would add a lot of complexity, stop after addressing the important ones and explain the tradeoff.
- If a fix would require risky architectural churn beyond the request, pause and surface that before continuing.

## Final response checklist

- Summarize the main fixes and why they were chosen.
- Mention any remaining issues intentionally left alone, with a brief reason.
- Report the verification commands you ran and whether they passed.
- Suggest a commit message, but do not create a commit.
