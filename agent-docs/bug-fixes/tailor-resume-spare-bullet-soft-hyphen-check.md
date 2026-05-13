Tailor Resume spare-bullet checks with PDF soft hyphens

- Bug: Spare-bullet line checks could fail with "The measured bullet segment could not be found" for valid bullets when the rendered PDF hyphenated a word at a line break, for example `dash- boards` while the annotated text was `dashboards`.
- Fix: Layout matching now normalizes soft line-break hyphens in exact text and compact fallback matching. Spare-bullet measurement also escapes literal `<` and `>` before compiling candidate LaTeX.
- Guardrail: Keep regression coverage with latency-style bullets such as `<250ms` that wrap near the end of a line. The check may still return `malformed: true` for a sparse final rendered line, but it should complete with a measurement instead of failing to find the segment.
