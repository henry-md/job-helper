Railway build missing pg types:
- Symptom: a clean Railway build passed install and compilation, then failed during Next.js TypeScript checking with `Could not find a declaration file for module 'pg'` from a direct `pg` import.
- Root cause: `pg` is imported by app code, but `@types/pg` was only available transitively through another package in the pnpm lockfile. Railway's clean pnpm install does not make transitive type packages root-visible for direct imports.
- Fix: add `@types/pg` as a direct dev dependency whenever app code imports from `pg`.
- Verification: rerun the Railway-style install/build commands after dependency changes: `pnpm install --frozen-lockfile --prefer-offline` and `pnpm run build`.
