Railway build Next typecheck included tests:
- Symptom: a clean Railway build failed during `pnpm run build` with `Cannot find name 'chrome'` from `extension/src/page-context.ts`.
- Root cause: the root Next.js `tsconfig.json` included `**/*.mts`, so production type-checking pulled in test files. `tests/page-context-error.test.mts` imports extension code, which depends on extension-only Chrome globals that are not installed in the root app build.
- Fix: keep test files out of the root production Next type-check surface by excluding `tests` in `tsconfig.json`; test execution still uses the explicit Node test command.
