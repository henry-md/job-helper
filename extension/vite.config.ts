import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { createManifest } from "./manifest.config";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const repoRootDir = resolve(extensionDir, "..");

function isTruthyEnvValue(value: string | undefined) {
  const normalizedValue = value?.trim().toLowerCase();
  return (
    normalizedValue === "1" ||
    normalizedValue === "true" ||
    normalizedValue === "yes" ||
    normalizedValue === "on"
  );
}

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, repoRootDir, ""),
    ...loadEnv(mode, extensionDir, ""),
    ...process.env,
  };

  return {
    plugins: [react(), crx({ manifest: createManifest(env) })],
    resolve: {
      alias: {
        "@": repoRootDir,
      },
    },
    define: {
      __DEBUG_UI__: JSON.stringify(
        isTruthyEnvValue(env.DEBUG_UI ?? env.VITE_DEBUG_UI),
      ),
      __HIDE_TOP_LVL_AI_CHAT__: JSON.stringify(
        isTruthyEnvValue(
          env.HIDE_TOP_LVL_AI_CHAT ?? env.VITE_HIDE_TOP_LVL_AI_CHAT,
        ),
      ),
    },
    server: {
      fs: {
        allow: [repoRootDir],
      },
      host: "localhost",
      port: 5186,
      strictPort: true,
    },
    build: {
      outDir: "dist",
    },
  };
});
