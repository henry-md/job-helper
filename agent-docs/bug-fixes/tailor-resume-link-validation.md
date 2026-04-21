Tailor Resume link hallucination guardrail:

- Resume extraction could emit polished-looking `\href{...}` targets that compiled cleanly but pointed at the wrong profile, repo, or site.
- Simple URL parsing was not enough because the failure mode was often "real URL, wrong destination" rather than malformed syntax.

Fix:

- Validate extracted `\href` targets server-side after LaTeX compilation succeeds.
- Compare URL-like visible link text against the generated destination to catch mismatched-but-valid links.
- Probe http/https links over the network, but treat reachability results as advisory `unverified` warnings. HTTP 404/403/5xx, DNS failures, timeouts, and refused connections are not reliable enough to fail resume generation.
- Retry the model only for deterministic local link failures, such as visible URL/email/phone text disagreeing with the generated `href`, or unsupported link protocols.
- If a link keeps failing validation, tell the model to preserve the visible text but remove hyperlink-only styling instead of guessing a new destination.
- Persist structured resume link records alongside the saved resume so uncertain destinations can be collected from the user once and reused later.
- Recover embedded PDF link annotations with `qpdf` and feed those URLs back into extraction as hints, since the model cannot reliably read PDF link targets on its own.
- Preserve a `disabled` flag when a user explicitly deletes a link so future regenerations strip `\href` and link-only styling instead of recreating the blue link from the visible label.
- Apply saved link edits back onto the current LaTeX deterministically when the user saves link changes, so updating or deleting a link does not trigger a fresh OpenAI extraction pass.
- When a saved link is deleted, keep the visible resume text in place and only remove hyperlink styling such as `\href` and `\tightul`.
- Reparse explicit `\href` links when the user saves raw LaTeX edits, preserve saved mappings for matching keys, and add new links from the updated document so link settings do not need to be re-entered after ordinary LaTeX edits.

Guardrail:

- Treat Tailor Resume links as untrusted until compilation and deterministic link validation pass.
- Do not fail generation just because an external URL cannot be reached by the validator; preserve the link and surface it as unverified instead.
- If the model is unsure about a destination, it must return `url: null` and keep the label plain-text instead of fabricating a convincing-looking link.
