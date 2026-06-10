Extension tailored-resume keywords popup refresh

- Symptom: clicking Show keywords for an already saved tailored resume could feel slow even though the row already had saved keyword data.
- Root cause: the background reveal handler reloaded the full personal-info payload whenever a tailored resume id was present, even when the side panel had already sent the saved job URL, keyword snapshot, coverage, and non-technology names needed to show the in-page popup.
- Fix: treat personal-info loading as a fallback only when the reveal payload is missing the target URL, saved keyword/coverage data, or non-technology terms.
- Guardrail: saved-resume keyword reveal should use the click payload first. Do not put a full personal-info sync on the critical path unless the payload is incomplete.
