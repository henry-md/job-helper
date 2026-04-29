Tailor Resume link-validation false positive for slash-separated labels:

- Symptom: repeated Step 3 Tailor Resume retries could fail on a project title like `C/C++ Ray Tracing Engine` even though the `\href` destination itself was correct.
- Root cause: the visible-link validator treated any display text containing `/` as URL-like, so human-readable labels with slashes were normalized into fake host/path strings and then compared against the real destination.
- Fix: only compare visible text against the `href` when the label genuinely looks like a hostname or explicit web URL, not just any slash-separated phrase.
- Guardrail: labels such as technology names, project titles, or role names can contain `/` and still be plain text. Slash presence alone is not enough evidence that the label is asserting a destination.
