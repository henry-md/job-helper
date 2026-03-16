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
- `src/content.ts`: content script that reads the active page title, URL, and meta description.
- `src/background.ts`: MV3 service worker entry.
- `public/manifest.json`: Chrome extension manifest.
