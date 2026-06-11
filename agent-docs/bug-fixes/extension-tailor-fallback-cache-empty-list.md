## Extension Tailor fallback cache showed an empty library

- Symptom: after starting Tailor Resume while Google was connected, the extension Tailor tab could show `0` and the zero-document empty state even though the Google-backed profile had saved tailored resumes.
- Root cause: when the background worker detected a sync-state change but failed to refresh `GET /api/tailor-resume`, it wrote an invalidated personal-info cache with `tailoredResumes: []`. The side panel treated that fallback cache as a ready authoritative payload.
- Fix: fallback invalidation now clears only transient active tailoring and interview state. It preserves cached saved tailored resumes and generation settings until a fresh profile fetch succeeds.
- Regression check: a sync-state-change fallback should never replace a non-empty saved Tailor library with an empty list.
