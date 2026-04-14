# Job Helper Extension

Vite + React Chrome extension for this repo, with CRXJS-powered hot reload during development.

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

The extension dev server is pinned to `http://localhost:5186`. If `npm run dev` is not running, Chrome will show a service-worker fetch error because the dev loader imports the background script from that local server.

Popup and content-script changes hot-update automatically. Background-script and manifest changes trigger an extension reload, so source edits no longer require manually rebuilding and reloading the extension.

## Production build

Run `npm run build`, then load `/Users/Henry/Developer/job-helper/extension/dist` as an unpacked extension in Chrome.

## Included pieces

- `src/App.tsx`: popup UI rendered with React.
- `src/content.ts`: content script that scrapes structured page evidence and renders the in-page command banner.
- `src/background.ts`: MV3 service worker entry that handles `Cmd+Shift+S` / `Ctrl+Shift+S`, captures the visible tab, and posts to `/api/job-applications/ingest`.
- `manifest.config.ts`: typed Chrome extension manifest source used by CRXJS/Vite.
