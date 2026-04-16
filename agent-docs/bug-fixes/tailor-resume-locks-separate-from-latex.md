Tailor Resume locked-link source separation:

- Bug: `profile.links[].locked` lived in the same file-backed structure as the mutable current LaTeX link parse.
- Result: when the user changed a `\href` destination in raw LaTeX and the app reparsed the document, that mutable parse could silently rewrite what was supposed to be a stable saved lock.
- Fix:
  - persist only locked links in Prisma (`TailorResumeLockedLink`)
  - strip `locked` flags before writing the file-backed Tailor Resume profile
  - hydrate a merged runtime view from `profile.links + TailorResumeLockedLink[]`
  - after any LaTeX edit, parse current links from LaTeX, merge in persisted locks by key, then run a separate injection pass before saving/compiling
- Key rule: the immutable lock source of truth lives in Prisma, and each LaTeX save re-applies those locks before the saved document is finalized.
