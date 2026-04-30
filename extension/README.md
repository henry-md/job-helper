# Job Helper Extension

Vite + React Chrome extension for this repo, with CRXJS-powered hot reload during development. The extension UI runs in Chrome's native Side Panel.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Development

1. Run `npm run dev`.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Load `/Users/Henry/Developer/job-helper/extension/dist` as an unpacked extension.
5. Keep the Vite dev server running while you work.

The extension dev server is pinned to `http://localhost:5186`. If `npm run dev` is not running, Chrome will show a service-worker fetch error because the dev loader imports the background script from that local server. The app API and OAuth origin the extension talks to is `http://localhost:1285`.

Side panel and content-script changes hot-update automatically. Background-script and manifest changes trigger an extension reload, so source edits no longer require manually rebuilding and reloading the extension.

## Browser preview

Run `npm run dev`, then open `http://localhost:5186/index.html`. In Vite dev
mode, that page installs a mock Chrome extension runtime so the real side-panel
React UI can be inspected and screenshotted without loading the unpacked
extension.

Useful states:

- `http://localhost:5186/index.html` shows the signed-out default state.
- `http://localhost:5186/index.html?auth=signed-in&run=success` shows a connected
  account with the latest tailoring result.
- `http://localhost:5186/index.html?snapshot=error` shows the active-tab error
  state.

## Shortcut

The extension registers `Cmd+Shift+S` on macOS and `Ctrl+Shift+S` elsewhere to
open the side panel and tailor the active job page. Chrome may require manually
assigning or confirming the shortcut at `chrome://extensions/shortcuts` if the
key binding conflicts with another extension or browser command.

## Auth

The extension uses Chrome's identity API, so the manifest needs a Google OAuth
client id for the extension itself:

```bash
GOOGLE_EXTENSION_CLIENT_ID=your-chrome-extension-client-id.apps.googleusercontent.com
VITE_JOB_HELPER_APP_BASE_URL=http://localhost:1285
DEBUG_UI=true # optional: enables the side-panel Debug tab
# Optional, but useful if you need a stable unpacked extension id.
CHROME_EXTENSION_PUBLIC_KEY=...
```

Recommended setup:

1. Build or run the extension, then load `/Users/Henry/Developer/job-helper/extension/dist`
   from `chrome://extensions`.
2. Copy the extension id from the extension card in `chrome://extensions`.
3. In the existing `job-helper` Google Cloud project, create a new OAuth client.
4. Choose application type `Chrome Extension`.
5. Paste the extension id into Google's `Item ID` field.
6. Copy the generated client id into `GOOGLE_EXTENSION_CLIENT_ID`.
7. Restart the root Next app and rebuild or restart the extension.

`GOOGLE_EXTENSION_CLIENT_ID` must be present in the root app environment because
`POST /api/extension/auth/google` verifies that Google issued the token for this
extension. `VITE_JOB_HELPER_APP_BASE_URL` must be present when Vite builds or
runs the extension because it is baked into the extension bundle. The extension
Vite config loads both the repo root `.env` and `extension/.env*`, so keeping
both values in the root `.env` is usually simplest. When `DEBUG_UI=true`, the
side panel shows a Debug tab with the current page's URL identity.

Chrome may not show a visible OAuth popup if the current Chrome profile already
has a usable Google session and the extension grant can be completed silently.
The side panel shows the connected account email and Google avatar so the user
can verify which account is active.

Unpacked extension ids are usually stable while loading the same folder, but
they can change if Chrome treats the extension as a new unpacked item. If the
development extension id changes, either update the Google OAuth client's Item
ID or set `CHROME_EXTENSION_PUBLIC_KEY` from the Chrome Web Store package key and
rebuild the extension.

The extension stores the returned Job Helper session token in
`chrome.storage.local` and sends it as a bearer token to app APIs. Opening the
dashboard goes through `/api/extension/auth/browser-session`, which creates a
short-lived browser handoff URL and then redirects to the protected dashboard.

Auth troubleshooting:

- `GOOGLE_EXTENSION_CLIENT_ID is required`: add it to the root `.env` and restart
  the Next app.
- `The Google token was not issued for this Chrome extension`: the Google OAuth
  client id or Item ID does not match the loaded extension id.
- The panel still points at localhost or the wrong deployment: update
  `VITE_JOB_HELPER_APP_BASE_URL`, then restart Vite or rebuild/reload the
  extension.
- A regular web sign-in client will not work here. Keep the existing web OAuth
  client for NextAuth and create a separate Chrome Extension OAuth client for the
  extension.

## Production build

Run `npm run build`, then load `/Users/Henry/Developer/job-helper/extension/dist` as an unpacked extension in Chrome.

## Included pieces

- `src/App.tsx`: native side panel UI rendered with React.
- `src/content.ts`: content script that scrapes page evidence and renders the in-page command banner.
- `src/background.ts`: MV3 service worker entry that handles `Cmd+Shift+S` / `Ctrl+Shift+S`, opens the side panel when Chrome allows it, formats the scraped page context into a job description, and calls `PATCH /api/tailor-resume` with `action: "tailor"`.
- `manifest.config.ts`: typed Chrome extension manifest source used by CRXJS/Vite.
