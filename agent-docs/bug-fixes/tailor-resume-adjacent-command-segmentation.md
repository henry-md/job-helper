Tailor Resume adjacent command segmentation:

- Symptom: adjacent sibling commands such as back-to-back `\resumeitem{...}` lines could collapse into one deterministic block, so the planner sent combined bullet text to OpenAI and the review UI looked like the model had merged bullets.
- Root cause: `readCommandAt(...)` skipped trailing newline/indentation while probing for another argument and returned that advanced cursor as the command end, so normalization resumed scanning from the next sibling command instead of from the whitespace after the current one.
- Fix: keep probing whitespace separate from the committed command boundary. Only advance the command end when the next non-whitespace token is actually another `[` or `{` argument, so sibling commands remain separate segments and planning blocks.
