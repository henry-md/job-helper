# Extension Tailor search across archive states

- Symptom: the Tailor tab search only appeared when viewing archived tailored resumes, so unarchived saved resumes could not be searched from the main Tailor list.
- Fix: keep one tailored-resume search control visible for both archive states, apply it to archived and unarchived saved-resume lists, and preserve active tailoring cards outside the saved-resume search filter.
- Guardrail: empty messages should distinguish between "no saved resumes yet" and "no resumes match that search" for each archive state.
