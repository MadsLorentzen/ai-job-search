# Codex Workflows

This folder documents how Codex maps onto the existing Claude Code workflow without replacing it.

Use the command-named Codex skills in `.agents/skills/`:

| Claude workflow | Codex entrypoint |
| --- | --- |
| `/setup` | `$setup` |
| `/apply <posting>` | `$apply <posting>` |
| `/rank` | `$rank` |
| `/interview` | `$interview` |
| `/outcome` | `$outcome` |
| `/expand` | `$expand` |
| `/reset` | `$reset` |
| `/add-template` | `$add-template` |
| `/add-portal` | `$add-portal` |
| `/scrape` | `$scrape` |
| `/upskill` | `$upskill` |

The `.claude/commands/*.md` and `.claude/skills/*` files remain the behavioral source of truth. `$setup` is the reliable Codex invocation; in Codex surfaces where skills appear in the slash menu, `/setup` may also be selectable.
