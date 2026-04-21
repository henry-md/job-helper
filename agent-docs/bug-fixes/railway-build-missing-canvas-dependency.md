Problem:
- Railway builds failed during `pnpm run build` after the server-side resume preview code started importing `@napi-rs/canvas`.

Cause:
- The app imported `@napi-rs/canvas` directly from `lib/tailored-resume-preview-snapshots.ts`, but the package was not declared in `package.json`.
- Local development could still appear fine when an undeclared package was already present in `node_modules`, while Railway's clean pnpm install exposed the missing dependency immediately.

Fix:
- Add `@napi-rs/canvas` as an explicit application dependency and update the pnpm lockfile.
- Re-verify with the same install/build commands Railway uses: `pnpm install --frozen-lockfile --prefer-offline` and `pnpm run build`.

Rule:
- If app code imports a package directly, declare it explicitly in the owning package manifest even if local tooling can currently resolve it transitively.
- When Railway fails on module resolution, trust the clean install and verify with the same package manager and frozen-lockfile path used in deployment.
