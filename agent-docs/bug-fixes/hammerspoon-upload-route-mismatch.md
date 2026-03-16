Problem:
- The README Hammerspoon snippet fired its hotkey alert, but the app did not show a new extracted application afterward.

Cause:
- The script was posting `file` uploads to `/upload`, which only writes a raw image into `public/uploads/` and returns JSON.
- The real intake flow uses `/api/job-applications/extract` plus a later save step, so the README path never triggered extraction or application creation.
- The sample Lua also treated the first `hs.osascript.applescript(...)` return value like the tab index, but that first value is the success flag.

Fix:
- Replace the stale Hammerspoon-only route with the shared `/api/job-applications/ingest` route that accepts screenshots, structured page context, or both, authenticates with a shared secret plus target user email when needed, and saves the resulting application and screenshot records in one request.
- Update the README Hammerspoon snippet to call that shared endpoint, send the required headers, surface upload failures, and refresh/open the dashboard after a successful ingest.
- Capture `screencapture` stderr in the README snippet and check `hs.screenRecordingState()` first, because missing Screen Recording permission makes the automation fail before the app receives any request.
