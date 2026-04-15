Tailor Resume link hallucination guardrail:

- Resume extraction could emit polished-looking `\href{...}` targets that compiled cleanly but pointed at the wrong profile, repo, or site.
- Simple URL parsing was not enough because the failure mode was often "real URL, wrong destination" rather than malformed syntax.

Fix:

- Validate extracted `\href` targets server-side after LaTeX compilation succeeds.
- Compare URL-like visible link text against the generated destination to catch mismatched-but-valid links.
- Probe http/https links over the network and retry the model only for definite failures.
- If a link keeps failing validation, tell the model to preserve the visible text but remove hyperlink-only styling instead of guessing a new destination.

Guardrail:

- Treat Tailor Resume links as untrusted until both compilation and link validation pass.
