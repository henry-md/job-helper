Extension Tailor Resume Greenhouse iframe keywords

- Symptom: Neuralink apply pages visually showed required languages like Python, C, and Rust, but Tailor Resume Step 1 scraped no terms.
- Root cause: the extension captured only the top frame's `document.body.innerText`. Neuralink renders the actual Greenhouse job application in an embedded cross-origin frame, while the top page text only contains site chrome and `Loading Job Application...`.
- Fix: augment captured page context with `chrome.scripting.executeScript({ allFrames: true })` snapshots, merging embedded frame text/headings into the top-page context while keeping the top URL/title as the page identity.
- Guardrail: embedded job-board pages can look correct in screenshots while top-frame text is empty. Verify frame-aware capture before debugging the keyword model.
