# Extension Tailor nested apply URL association

- Historical problem: some job sites navigated from an original posting URL to a nested path such as `/apply`, so saved state once followed nested pages through containment-style matching.
- Current fix: Tailor Resume association is exact-URL and query-sensitive because job sites can encode real job identity in query params. Nested apply pages should not inherit a saved tailored resume unless the stored URL is exactly that nested URL after hash/trailing-slash normalization.
- Guardrail: do not use containment matching for page overwrite prompts, badges, blue current-page outlines, or local Tailor registry lookup without an explicit product decision.
