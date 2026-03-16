# Job Helper Extension

Vite + React Chrome extension starter for this repo.

## Commands

```bash
npm install
npm run build
```

Then load `/Users/Henry/Developer/job-helper/extension/dist` as an unpacked extension in Chrome.

## Included pieces

- `src/App.tsx`: popup UI rendered with React.
- `src/content.ts`: content script that scrapes structured page evidence and renders the in-page command banner.
- `src/background.ts`: MV3 service worker entry that handles `Cmd+Shift+S` / `Ctrl+Shift+S`, captures the visible tab, and posts to `/api/job-applications/ingest`.
- `public/manifest.json`: Chrome extension manifest.
