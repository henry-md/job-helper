import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Job Helper",
  description: "React and Vite starter for capturing page data from the active Chrome tab.",
  version: "0.1.0",
  action: {
    default_popup: "index.html",
    default_title: "Job Helper",
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  permissions: ["scripting", "storage", "tabs"],
  host_permissions: ["<all_urls>"],
  commands: {
    capture_job_page: {
      suggested_key: {
        default: "Ctrl+Shift+S",
        mac: "Command+Shift+S",
      },
      description: "Capture the current job page for Job Helper",
    },
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content.ts"],
      run_at: "document_idle",
    },
  ],
});
