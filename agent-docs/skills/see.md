---
name: see
description: Show the raw contents of another skill's SKILL.md file when the user explicitly invokes the see skill, such as `/see test` or `$see test`. If the user invokes see without a second argument, treat it as a request to inspect the most recently created skill in the current conversation history. Do not use for general code or file browsing.
---

# See

Resolve the target skill name, read its `SKILL.md`, and return the file contents exactly so the user can inspect the prompt text without navigating manually.

## Resolve the target skill

Determine the target skill name in this order:

1. Parse the first token after the explicit `see` invocation.
2. If no second token is present, use the most recently created skill in the current conversation history.
3. If neither source yields a target skill, treat the request as malformed.

Normalize the target skill name before lookup:

- Strip a leading `/` or `$`.
- Trim whitespace.
- Treat the remaining text as the exact skill name.

## Find the skill file

Prefer a concrete skill path already established in the current conversation history when one exists for the target skill.

Otherwise, check these exact locations in order and use the first match:

1. `~/.codex/skills/<skill-name>/SKILL.md`
2. `~/.agents/skills/<skill-name>/SKILL.md`
3. `.agents/skills/<skill-name>/SKILL.md` in the current working directory and then each parent directory up to the repository root

Do not fuzzy-match similar names. Only open an exact `<skill-name>/SKILL.md` match.

## Output

Read the target `SKILL.md` file and return its contents verbatim in a fenced markdown code block.

Do not summarize, explain, or prepend navigation text.
Do not paraphrase.
Do not include any files other than `SKILL.md` unless the user explicitly asks for them.
