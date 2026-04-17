import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Job Helper",
  description: "Scrape the active job page and run Tailor Resume from a keyboard shortcut.",
  version: "0.1.0",
  icons: {
    "16": "icon16.png",
    "32": "icon32.png",
    "48": "icon48.png",
    "128": "icon128.png",
  },
  action: {
    default_popup: "index.html",
    default_title: "Job Helper",
    default_icon: {
      "16": "icon16.png",
      "32": "icon32.png",
      "48": "icon48.png",
      "128": "icon128.png",
    },
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
      description: "Tailor your resume for the current job page",
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
