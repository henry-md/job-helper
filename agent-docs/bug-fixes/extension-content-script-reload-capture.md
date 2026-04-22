Problem:
- The Chrome side panel could report that it could not read the current job page even while a normal job posting tab was active.
- Failed tailoring runs also lost the active tab URL, which made the error look like no page had been selected.

Cause:
- After extension reloads or first install, already-open tabs may not have the current content script listener injected.
- The side panel and background service worker only tried `chrome.tabs.sendMessage`, so a missing listener was treated the same as an unparsable page.

Fix:
- Share a tab page-context collector that first messages the content script, then injects the packaged content script from the manifest and retries once.
- Preserve the active tab title and URL in failed tailoring records even when page text capture fails.
