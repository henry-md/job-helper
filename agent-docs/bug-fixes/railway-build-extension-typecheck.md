Problem:
- Railway production deploys started failing even though the Next app worked locally.
- The failure appeared during `next build`, not while booting the deployed app.

Cause:
- The root `tsconfig.json` included every `**/*.ts` and `**/*.tsx` file in the repository.
- That made Next's production typecheck pull in `extension/manifest.config.ts`, which belongs to the separate Chrome extension project.
- `extension/manifest.config.ts` imports `@crxjs/vite-plugin`, but Railway only installs the root app dependencies, not the extension's separate toolchain.
- Local builds can hide this because `extension/node_modules` may already exist on a developer machine.

Fix:
- Exclude `extension/` from the root TypeScript project so `next build` only checks the Next app.
- Keep the browser extension as its own isolated toolchain under `extension/`.

Rule:
- If the repo contains multiple apps/toolchains, do not let the Next app's root TypeScript config glob into sibling projects.
