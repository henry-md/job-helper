Tailor Resume review meaningful inline context:

- Symptom: the review modal's side-by-side LaTeX diff could highlight long unchanged phrases inside a modified line, such as bold metrics that appeared on both sides of the diff.
- Root cause: after token diffing, the inline renderer collapsed everything from the first changed segment to the last changed segment into one highlight run, even when the middle contained meaningful shared text.
- Fix: keep coalescing tiny glue such as whitespace, punctuation, and short non-substantive bridges, but stop merging across shared context that renders as meaningful visible text.
- Guardrail: if a modified line contains a real unchanged anchor like a metric, product name, or formatted phrase, that anchor should stay neutral in the side-by-side diff instead of being swallowed into one amber block.
