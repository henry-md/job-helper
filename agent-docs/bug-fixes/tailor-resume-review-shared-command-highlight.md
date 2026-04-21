Tailor Resume review shared command highlight:

- Symptom: the side-by-side LaTeX diff could highlight a shared block command such as `\resumeitem{` on the tailored side when only incidental indentation differed before the command.
- Root cause: whitespace-only changed spans were allowed to coalesce across non-visible LaTeX context, so the shared block command became part of the changed highlight range.
- Fix: keep shared block-level LaTeX commands such as `\resumeitem`, `\entryheading`, `\descline`, `\labelline`, `\begin`, and `\end` as hard context boundaries while still allowing inline formatting commands like `\textbf` to participate in broad phrase highlights.
