# Skills

Each file in this directory defines a reusable task.

Invoke with:
/<file-name-in-kebab-case>

Example:
/write-pr-description

Skills are task-specific instructions that direct the agent to perform a job in a repeatable way.

The user may:
- Create a skill manually
- Ask the agent to create a skill
- Invoke a skill using slash commands

Skill files should be concise. Each `agent-docs/skills/[skill].md` file should briefly outline what the skill is, what it should do, and any important constraints or steps to follow. The filename should be the skill name in kebab-case, matching the slash command.

Examples:
- `agent-docs/skills/write-pr-description.md` → invoked with `/write-pr-description`
- `agt-docs/skills/refactor-auth-flow.md` → invoked with `/refactor-auth-flow`

When a relevant skill exists, the agent should follow it.
