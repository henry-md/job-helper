Extension keyword coverage matrix

- Symptom: completed Tailor Resume job-keyword popups switched from the Step 1 skills-section/narrative by high/low matrix into flat coverage lists, and long coverage payloads could silently omit rendered terms.
- Fix: keep the matrix as the only keyword layout before and after tailoring. Completed popups now use keyword coverage only to color matrix chips as In Base / In New / In Neither and to power the legend, while rendering every normalized coverage term without hidden caps.
- Guardrail: do not replace the matrix with priority-only lists when `keywordCoverage` is present. If coverage data is available, use it as decoration/status on the classified keyword set, not as a separate display source.
- Follow-up: the extension background reveal/refresh paths must preserve `keywordCoverage` and `tailoredResumeId` when reopening keywords for saved tailored resumes. Dropping coverage recreates the uncolored matrix even when the content script can render the legend and chip tones.
