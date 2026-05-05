# Extension Tailor nested apply URL association

- Problem: The extension associated the current browser page with saved tailoring state only when normalized URLs were equal. Some job sites keep the original posting URL for saved state, then navigate the browser to a nested path such as `/apply`, which made the saved tailored resume or local tailoring registry entry look unrelated.
- Fix: Compare normalized URLs by checking whether the current page URL contains the saved job URL. Apply this to page overwrite/badge matching and local Tailor registry lookup so saved state follows nested application pages.
- Guardrail: Keep exact URL normalization for dedupe identity, but use the containment helper only for current-page-to-saved-page association where the browser URL is expected to be the more specific value.
