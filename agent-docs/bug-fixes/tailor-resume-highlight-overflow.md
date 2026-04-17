Tailor Resume review PDF highlight overflow:

- Symptom: highlighted review PDFs could clip past the right edge of the page even though the clean compiled resume wrapped correctly.
- Trigger: a modified resume line was wrapped in one large `\jhlmod{...}` span that also enclosed formatting commands like `\textbf{...}`.
- Root cause: the review preview uses `ulem` highlight macros (`\markoverwith ... \ULon`) so the highlight remains breakable. That works for plain inline text, but a single outer highlight span around nested formatting can become effectively too rigid in narrow resume bullets and stop wrapping the way the original line did.
- Fix: keep the “first added diff segment to last added diff segment” range selection, but split the rendered highlight at inline formatting boundaries. Plain text and punctuation stay coalesced; formatted chunks are highlighted from inside their own command, such as `\textbf{\jhlmod{AWS Amplify}}`, instead of being trapped inside one outer `\jhlmod{...}`.
- Guardrail: do not reintroduce logic that wraps a whole modified LaTeX range when it contains formatting commands, even if the range looks inline-safe. That regression can reintroduce PDF clipping.
