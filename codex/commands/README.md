# Codex Command Wrappers

Codex does not currently use this folder as a native slash-command runtime.
These files are project-local workflow entry points for Codex sessions.

When the user asks for a command-like action, read the matching wrapper first,
then read and execute the referenced Claude workflow spec or skill using the
tool translation rules in `AGENTS.md`.

Keep these wrappers thin. The detailed workflow stays in `.claude/commands/`
and `.claude/skills/` so Claude Code and Codex do not drift apart.

