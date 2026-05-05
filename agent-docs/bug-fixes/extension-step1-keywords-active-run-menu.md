Extension Step 1 keywords active-run menu:

- Symptom: after Step 1 keyword scraping finished, active Tailor Resume runs in Step 2 had no menu action to re-open the in-page keyword popup, and normal tab badge refresh could remove the Step 1 popup when no completed tailored-resume badge existed yet.
- Root cause: active run cards did not carry or render their scraped emphasized technologies, and background badge refresh always hid the shared in-page prompt surface when there was no completed tailored resume for the tab.
- Fix: preserve Step 1 emphasized technologies on active run cards, show a `Show keywords` menu action for active runs with keywords, let the reveal message send active-run keywords directly to the job tab, and skip the completed-badge hide when an active keyword badge was shown.
