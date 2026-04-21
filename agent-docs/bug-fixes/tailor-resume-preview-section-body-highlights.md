Tailor Resume preview section body highlights:

- Symptom: interactive PDF highlights could mark an unchanged section heading such as `TECHNICAL SKILLS` while missing changed text immediately below it.
- Root cause: the preview plain-text renderer greedily consumed every following `{...}` group as an argument to the preceding command. A block like `\resumeSection{TECHNICAL SKILLS}` followed by a top-level body group was reduced to only the heading text, so the interactive preview fell back to focus-highlighting the heading.
- Fix: give the preview renderer explicit argument limits for known resume/LaTeX commands, with environment-specific handling for layout commands that do take extra groups.
- Guardrail: when changing preview matching, include section-heading-plus-body fixtures so shared headings stay neutral and changed body text remains highlightable.
