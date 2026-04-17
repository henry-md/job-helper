Problem:
- Railway production builds failed during `pnpm run build` even though the app could appear to work locally.

Cause:
- `lib/tailor-resume-review.ts` imports `diff`, but the root app did not declare `diff` as a direct dependency.
- Local machines can hide this when `node_modules` already contains `diff` transitively or from prior installs.
- Once the missing dependency was fixed, the clean production build also surfaced stricter Next/TypeScript errors that local workflows had not been catching.
- A follow-up edit changed `package.json` to `"diff": "^8.0.3"` while `pnpm-lock.yaml` still recorded the importer specifier as `8.0.3`, so Railway's `pnpm install --frozen-lockfile` failed with `ERR_PNPM_OUTDATED_LOCKFILE` before the build ran.

Fix:
- Add `diff` to the root app dependencies so Railpack installs it in a clean environment.
- Keep the `diff` specifier exactly aligned between `package.json` and `pnpm-lock.yaml`; if `npm` rewrites the manifest with a caret range, restore or regenerate the pnpm lockfile before deploying.
- Keep the Tailor Resume preview route returning a web-compatible binary body (`Blob`) instead of passing a Node `Buffer` directly into `NextResponse`.
- Regenerate Prisma client after schema/model changes so build-time typechecks see the current models.

Rule:
- If a runtime import is used by the Next app, declare it directly in the root package manifest even if local installs happen to resolve it transitively.
- Treat Railway clean builds as the source of truth for missing-dependency issues; local `node_modules` can mask them.
- When this repo uses `pnpm install --frozen-lockfile` in production, any manifest edit made via `npm` must be checked against `pnpm-lock.yaml` before shipping.
