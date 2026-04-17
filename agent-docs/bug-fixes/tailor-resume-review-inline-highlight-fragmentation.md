Tailor Resume review inline highlight fragmentation:

- Symptom: the review modal's side-by-side LaTeX diff could render modified lines as a row-tinted block plus many tiny word-level pills, which made replacements hard to scan and sometimes showed highlighted blank space at the left or right edge.
- Root cause: inline diff tokenization preserved whitespace/context tokens between changed words, and the DOM renderer painted each non-context token separately while also tinting the entire modified row.
- Fix: collapse each modified row's display highlight to one range from the first changed token to the last changed token, trim whitespace off the outer edges of that range, and keep the row background neutral so only the changed text is highlighted.
- Guardrail: for modified rows in the div review, do not reintroduce whole-row amber fills or per-word highlight pills unless the product explicitly wants token-by-token review again.
