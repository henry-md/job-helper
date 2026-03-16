Unified ingestion flow:
- `POST /api/job-applications/ingest` is the shared entry point for non-dashboard capture clients such as Hammerspoon and the Chrome extension.
- The route accepts any mix of `jobScreenshots` files and one `pageContext` JSON payload. Clients may send screenshots only, page text/structure only, or both.
- Auth resolves in this order: existing NextAuth session first, then the shared secret (`JOB_HELPER_INGEST_SECRET`, with legacy fallback to `HAMMERSPOON_INGEST_SECRET`) plus `X-Job-Helper-User-Email`.

Evidence strategy:
- Hammerspoon sends screenshot evidence only.
- The Chrome extension sends a visible-tab screenshot plus structured browser evidence: URL, title, description, cleaned page text, headings, salary/location/employment hints, and JSON-LD JobPosting snippets when present.
- `lib/job-application-extraction.ts` merges all evidence into the existing `JobApplicationExtraction` schema in one OpenAI call.

Persistence:
- The ingest route auto-saves a `JobApplication` when extraction can determine at least the job title and company name.
- When screenshots are present, each one is persisted under `public/uploads/job-screenshots/<userId>/` and linked through `JobApplicationScreenshot`.
