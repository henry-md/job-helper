Problem:
- Railway production builds failed before dependency installation even started.
- The Railpack builder detected Node and pnpm, then stopped with `Failed to resolve version 9 of pnpm`.

Cause:
- The root app relied on Railway inferring pnpm from the lockfile, but it did not pin an exact root `packageManager` version in `package.json`.
- That left Railpack resolving a loose major version (`9`) instead of an explicit release.

Fix:
- Pin the root `packageManager` to the exact pnpm release Railway had already resolved successfully for this repo: `pnpm@9.15.9`.
- Re-verify with Railway-style clean commands (`pnpm install --frozen-lockfile --prefer-offline` and `pnpm run build`) so the app still builds once package-manager resolution succeeds.

Rule:
- When Railway/Railpack is responsible for choosing the package-manager binary, pin the exact root package-manager version in `package.json` instead of relying on lockfile inference alone.
