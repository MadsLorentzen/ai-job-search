# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are vetted checkpoints of `master`. If you maintain a personalized fork,
prefer updating to a tagged release over pulling raw `master` (see
[SETUP.md, section 8](SETUP.md#8-pulling-upstream-updates-into-your-fork)). The
`framework_version` markers on methodology files tell you which of your customized
files a release touched; `python3 tools/check_upstream_updates.py` lists them with
per-file diff commands.

## [Unreleased]

_Changes landed on `master` since the last release will be listed here._

## [1.0.0] - 2026-07-22

First tagged release. This marks the framework as stable and gives forks a described
checkpoint to update against instead of a moving `master`. It is a baseline of what
already exists rather than a set of new changes; subsequent releases will document
what changed since the previous tag.

At this baseline the framework provides:

- **Application workflow** - a drafter/reviewer `/apply` pipeline (CV + cover letter),
  plus `/setup`, `/scrape`, `/rank`, `/interview`, `/outcome`, `/upskill`,
  `/expand`, `/html-report`, `/gmail-sync`, `/notion-sync`, `/add-portal`,
  `/add-template`, and `/reset`.
- **Portal search skills** - country-agnostic job-board CLIs (LinkedIn, freehire, and
  the Danish boards) in the portable Agent Skills format under `.agents/skills/`,
  discovered and orchestrated by `/scrape`, with an `enabled:` toggle for skipping
  portals.
- **Framework versioning** - `framework_version` markers on methodology files plus
  `tools/check_framework_version.py` (CI guard) and `tools/check_upstream_updates.py`
  (fork-side update preview).
- **Privacy and safety guards** - `.gitignore` protection for personal data, the
  `tools/security_guards.py` allowlist for `.gitignore` negations, and a CI policy of
  making no live portal requests.
- **Cross-runtime support** - a root `AGENTS.md` pointer so Codex and Antigravity can
  discover the portable portal skills, with Claude Code as the reference runtime.

[Unreleased]: https://github.com/MadsLorentzen/ai-job-search/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/MadsLorentzen/ai-job-search/releases/tag/v1.0.0
