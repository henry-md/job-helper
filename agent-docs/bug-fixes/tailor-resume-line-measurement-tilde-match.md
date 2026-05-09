## Tailor Resume line measurement tilde matching

- Bug: spare-bullet line measurement could compile the candidate PDF but fail to find the measured segment when the bullet contained an approximate value such as `~30%`.
- Root cause: LaTeX renders escaped `\~{}` as tilde glyph variants in PDF text extraction, including a combining tilde. The layout matcher normalized whitespace and dash variants but did not normalize those tilde forms back to plain `~`.
- Fix: normalize PDF-extracted and anchor text through the same tilde/caret variant mapping before matching rendered text ranges.
