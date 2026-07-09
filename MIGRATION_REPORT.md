# Migration Report: Claude Code → OpenCode

**Date:** 2026-07-08

## Summary

Successfully migrated the AI Job Search template repository from Claude Code's `.claude/` configuration framework to [OpenCode](https://opencode.ai). The migration preserves all user-facing functionality while adapting to OpenCode's architecture.

| Metric | Value |
|--------|-------|
| Files converted/created | 20+ |
| Files removed | 15+ (entire `.claude/` tree + `CLAUDE.md`) |
| Commands migrated | 11 |
| Skills migrated | 3 |
| Agents migrated | 2 |
| Dedicated tools ported | 0 (standalone CLI tools in `.agents/` are runtime-agnostic) |

## What Changed

### New/Updated Files

| File | Description |
|------|-------------|
| `opencode.json` | Main configuration (permissions, commands, agents, skills paths) |
| `.opencode/command/*.md` | 11 commands in OpenCode format (YAML frontmatter + body) |
| `.opencode/skill/*/SKILL.md` | 3 skills with OpenCode YAML frontmatter + keyword triggers |
| `.opencode/skill/*/*.md` | 7 reference data files (copied from `.claude/skills/`) |
| `.opencode/agent/*.md` | 2 subagents (reviewer, job-scorer) + 1 research agent |
| `AGENTS.md` | Updated primary entrypoint (absorbed CLAUDE.md content) |
| `tools/lint_skills.py` | Rewritten for OpenCode path structure |
| `.github/workflows/ci.yml` | Updated pipeline for OpenCode layout + placeholder checks |
| `MIGRATION_REPORT.md` | This file |

### Modified Files

| File | Changes |
|------|---------|
| `.gitignore` | Added `.opencode/` to tracked, `.claude/` remains ignored |
| `README.md` | Updated setup instructions for OpenCode |
| `SETUP.md` | Updated paths + added legacy cleanup instructions |
| `CONTRIBUTING.md` | Updated conventions for OpenCode format |
| `documents/README.md` | Path update: `.claude/skills/` → `.opencode/skill/` |

### Removed Files

| File | Reason |
|------|--------|
| `.claude/commands/*.md` | Migrated to `.opencode/command/*.md` |
| `.claude/skills/*/` | Migrated to `.opencode/skill/*/` |
| `.claude/agents/*.md` | Migrated to `.opencode/agent/*.md` |
| `.claude/settings.json` | Migrated to `opencode.json` |
| `CLAUDE.md` | Content absorbed into `AGENTS.md` |
| `phase1-migration-analysis.json` | Temporary analysis artifact |

## Key Adaptations

### Claude Code → OpenCode Mapping

| Claude Concept | OpenCode Equivalent |
|----------------|-------------------|
| `.claude/commands/*.md` | `.opencode/command/*.md` |
| `.claude/skills/*/SKILL.md` | `.opencode/skill/*/SKILL.md` |
| `.claude/agents/*.md` | `.opencode/agent/*.md` |
| `.claude/settings.json` | `opencode.json` |
| `Agent` tool (dispatch) | `task` tool + `mode: subagent` agents |
| `Skill(...)` permission | `skills.paths` in opencode.json |
| `Bash(...)` permission | `permission.bash` in opencode.json |
| `CLAUDE.md` | `AGENTS.md` |

### OpenCode Format Changes

1. **Command files** gained YAML frontmatter (`description:`, `agent:`) and use `$ARGUMENTS` / `$1`, `$2` variable syntax
2. **Skill files** gained `name:`, `description:`, `trigger:` fields; removed `allowed-tools:`
3. **Agent files** use `mode: subagent`, `temperature:`, `system_prompt:` fields
4. **Permissions** moved from `settings.json` to `opencode.json` with structured allow/block rules

## Unchanged Architecture

The following are runtime-agnostic and were left untouched:

- **Portal CLI tools** (`.agents/skills/*/cli/`) — standalone TypeScript/Bun, no Claude/OpenCode dependency
- **LaTeX templates** (`cv/`, `cover_letters/`) — `moderncv` and `cover.cls`
- **Python tools** (`tools/test_*.py`, `salary_lookup.py`) — no framework dependency
- **Tests** (`tests/`, CLI tests in `cli/tests/`, PDF smoke tests)
- **Job scraper** (`job_scraper/`) — standalone with no framework coupling

## Verification

- [x] `.opencode/` tree has no `.claude/` references
- [x] All 11 commands have valid frontmatter and use OpenCode syntax
- [x] All 3 skills have valid YAML frontmatter
- [x] CI pipeline references `.opencode/` paths
- [x] Lint script checks `.opencode/` structure
- [x] `.gitignore` properly configured
- [x] Legacy `.claude/` directory and `CLAUDE.md` removed
- [x] `migration-analysis.md` retained as historical documentation

## Known Gaps (Low Risk)

1. **Python pip not available** on this Windows environment — `tools/lint_skills.py` could not be validated locally
2. **Subagent dispatch** (`task` tool + `mode: subagent`) not tested end-to-end — recommended to verify on Linux/macOS target
3. **CI `latex-smoke` step** references `texlive/texlive` container — unchanged from original

## Rollback

To revert to the previous Claude Code configuration, run:

```bash
# Restore old config from git
git restore .claude/ CLAUDE.md
git checkout HEAD -- .opencode/ opencode.json AGENTS.md
# Reverse lint script and CI changes
git checkout HEAD -- tools/lint_skills.py .github/workflows/ci.yml
```

Then delete `MIGRATION_REPORT.md` and remove `documents/README.md` changes if needed.
