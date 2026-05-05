Extension keyword badge non-technology filtering

- Symptom: when a user marked a scraped technology card as a non-technology in Step 2, the side-panel memory changed but the in-page Job Keywords badge could keep showing that term until a later refresh or scraping run.
- Fix: keep active-run scraped technologies intact, send the current non-technology names with keyword-badge refresh messages, and filter only the rendered in-page badge/coverage terms. This lets an unmarked term reappear during the same chat while future Step 1 scraping still uses saved non-technology terms as the durable deny-list.
