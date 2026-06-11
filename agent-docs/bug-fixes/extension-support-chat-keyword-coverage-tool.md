Extension support chat keyword coverage tool:

- Symptom: Resume Chat could answer keyword-coverage questions by manually comparing raw LaTeX and scraped keyword lists, which made it easy to miss extracted terms or misstate which terms were still absent.
- Fix: expose a deterministic `list_current_job_keyword_coverage` support-chat tool. It returns every extracted keyword for the attached page or latest tailoring run, current source-resume coverage, tailored-resume coverage when available, and skills-section blockers.
- Guardrail: when a user asks which extracted keywords were returned, which are in the resume, which were newly added, or which remain missing, prefer the coverage tool over eyeballing LaTeX or summarizing from memory.
