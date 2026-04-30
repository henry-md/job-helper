Extension Tailor Resume overwrite prompt shell:

- Symptom: when starting Tailor Resume for a job URL that already had a completed saved tailored resume, the overwrite prompt could flicker on and then disappear while the saved resume row stayed visible.
- Root cause: the overwrite prompt was rendered inside the legacy run shell, but that shell was suppressed as soon as the current-page completed tailored-resume row appeared.
- Fix: keep the legacy run shell mounted when a current-page overwrite prompt exists, even if the completed resume row also matches the page.
- Guardrail: current-page completed resume rows should not suppress blocking confirmation UI; confirmation prompts need a stable container until the user cancels or confirms.
