Problem:
- Chrome's raw `Receiving end does not exist` message could appear when Tailor Resume tried to read a tab without a live content-script listener.
- The extension then stored that as a Tailor Resume run error, so the side panel rendered a page-capture failure in the tailored-resume run shell.

Fix:
- Normalize missing content-script listener errors to a page-read message after the injection retry.
- Mark page-capture failures separately and render them as a plain page-capture notice instead of a tailored resume/run card.

Guardrail:
- Errors that happen before a job page is read are not tailored resumes. Keep them out of tailored-resume run surfaces unless a real tailoring run exists.
