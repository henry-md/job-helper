Problem:
- Tailor Current Page could fail on an already-open job tab with "Could not read this page" even when the visible page contained usable job details.
- This was most likely after extension reloads or prior failed tailoring attempts, when the normal content-script listener was missing or stale.

Fix:
- Keep the normal content-script message path first.
- If the listener is missing and full content-script reinjection does not restore it, fall back to a small one-shot DOM collector via `chrome.scripting.executeScript`.
- The fallback returns the same `JobPageContext` shape so tailoring can start without requiring a manual page refresh.

Guardrail:
- Missing content-script listeners are a recoverable page-capture condition on ordinary web pages. Preserve a direct DOM read fallback before surfacing a refresh-required error.
