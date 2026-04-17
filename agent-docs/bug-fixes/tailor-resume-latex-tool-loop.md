Tailor Resume LaTeX compile retry loop:

- Some uploaded resumes produced LaTeX that looked structurally close but still failed `pdflatex`, often because the model emitted unsupported Unicode or malformed alignment markup.
- A single extraction attempt left users with a broken draft immediately, even when the compiler error was precise enough for the model to fix on a second pass.

Fix:

- Run resume extraction through a bounded Responses tool loop instead of accepting the first draft blindly.
- Have the model call a local `validate_resume_latex` tool with the full document, compile it server-side, and feed the exact compile error back into the next attempt.
- For attempts 2+, send a stronger retry prompt that reattaches the original resume evidence and includes the previous full LaTeX draft explicitly, so the model can edit the last draft surgically instead of repeating the same blind rewrite.
- Stop after 3 attempts; if none compile, keep the last LaTeX draft plus the final compile error so the UI can explain what failed.
- Return attempt-by-attempt extraction status to the Tailor Resume workspace so Sonner can show explicit retry and success toasts in the lower-right corner.

Guardrail:

- For generated Tailor Resume LaTeX, validate each model draft with the local compiler before treating it as ready or writing the preview PDF.
