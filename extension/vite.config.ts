import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { createManifest } from "./manifest.config";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const repoRootDir = resolve(extensionDir, "..");

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, repoRootDir, ""),
    ...loadEnv(mode, extensionDir, ""),
    ...process.env,
  };

  return {
    plugins: [react(), crx({ manifest: createManifest(env) })],
    server: {
      host: "localhost",
      port: 5186,
      strictPort: true,
    },
    build: {
      outDir: "dist",
    },
  };
});
