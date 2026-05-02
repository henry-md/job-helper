import { defineManifest } from "@crxjs/vite-plugin";

type ManifestEnv = Partial<Record<string, string | undefined>>;

const googleExtensionScopes = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function readGoogleExtensionClientId(env: ManifestEnv) {
  return (
    env.GOOGLE_EXTENSION_CLIENT_ID?.trim() ||
    env.VITE_GOOGLE_EXTENSION_CLIENT_ID?.trim() ||
    ""
  );
}

export function createManifest(env: ManifestEnv = process.env) {
  const googleExtensionClientId = readGoogleExtensionClientId(env);
  const extensionPublicKey =
    env.CHROME_EXTENSION_PUBLIC_KEY?.trim() ||
    env.VITE_CHROME_EXTENSION_PUBLIC_KEY?.trim() ||
    "";

  return defineManifest({
    manifest_version: 3,
    name: "Job Helper",
    description:
      "Scrape the active job page and run Tailor Resume from Chrome's side panel.",
    version: "0.1.0",
    minimum_chrome_version: "116",
    icons: {
      "16": "icon16.png",
      "32": "icon32.png",
      "48": "icon48.png",
      "128": "icon128.png",
    },
    action: {
      default_title: "Open Job Helper",
      default_icon: {
        "16": "icon16.png",
        "32": "icon32.png",
        "48": "icon48.png",
        "128": "icon128.png",
      },
    },
    side_panel: {
      default_path: "index.html",
    },
    background: {
      service_worker: "src/background.ts",
      type: "module",
    },
    permissions: [
      "alarms",
      "downloads",
      "identity",
      "scripting",
      "sidePanel",
      "storage",
      "tabs",
    ],
    host_permissions: ["<all_urls>"],
    ...(extensionPublicKey ? { key: extensionPublicKey } : {}),
    ...(googleExtensionClientId
      ? {
          oauth2: {
            client_id: googleExtensionClientId,
            scopes: googleExtensionScopes,
          },
        }
      : {}),
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
}

export default createManifest();
