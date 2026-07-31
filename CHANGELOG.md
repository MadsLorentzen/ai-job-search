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

### Added

- **`/rank` now persists `strengths` and `gaps` into `seen_jobs.json`** - Step 2's scoring
  agents already produced both arrays per job; Step 4 previously kept only `rank_score`,
  `rank_verdict`, and `rank_date`, so the honest per-posting findings were printed once in
  Step 5 and then discarded. Both arrays are now stored verbatim and replaced (never
  accumulated) on `--all` re-ranks, so downstream consumers of `seen_jobs.json` can read
  real triage findings instead of re-deriving them. See
  [discussion #258](https://github.com/MadsLorentzen/ai-job-search/discussions/258).

### Security & privacy

- **The gitignore guard now covers two more personal-data rules** - `security_guards.py`
  requires `cover_letters/Cover_*.*` (the uppercase cover-letter naming variant `/apply`
  recognizes) and `cv/*.txt` (ATS text extractions of tailored CVs) in `.gitignore`, so a
  future change weakening either rule fails CI instead of silently making personal files
  trackable. Both rules were already present in `.gitignore`; only the guard lagged.

### Fixed

- Removed the vestigial `cover_letters/OpenFonts/cover.cls` - an unreferenced remnant of
  the original font bundle that, since #252's class rename, ambiguously declared the same
  `cover` class as the real `cover_letters/cover.cls`.
- Added regression tests pinning #252's ragged-row bounds fix in
  `tools/convert_salary_excel.py` (dimension-less workbooks read in `read_only` mode
  yield rows shorter than the header).

## [1.1.0] - 2026-07-30

### Security & privacy

- **Personalized custom-template files are now gitignored regardless of engine** - the
  ignore rules broadened from `cv/main_*.tex` to `cv/main_*.*` (and likewise for cover
  letters), so a fork using a Typst or other non-LaTeX template no longer commits
  personalized `main_<company>.typ` files to a public fork. The `*_example.tex` files stay
  tracked. If you registered a custom template before this release, check
  `git status` once after updating. (#238)
- **Dependency review is live, for forks too** - the repo's Dependency graph is now enabled,
  so the CI `dependency-review` job actually blocks PRs that introduce dependencies with
  known high-severity vulnerabilities, and the job is no longer gated to the upstream repo:
  forks get the same check, self-activating if the fork enables Dependency graph
  (it warns-and-passes otherwise). (#254)

### Added

- **freehire-search: full descriptions come back with the search** - `search` now calls
  freehire's agent search endpoint (`/api/v1/agent/jobs/search`), which serves each hit's
  complete description instead of the search index's truncated preview. A 20-role search is
  one request rather than 1 + 20 `detail` calls, and `/scrape`'s Step 2 no longer needs a
  per-hit fetch for this portal. `--description-format markdown|text|html` (default
  `markdown`) selects the rendering; `table` and `plain` output is unchanged. (#251)
- **Custom templates: any compile-to-PDF toolchain (Typst, ...)** - `/add-template` no longer
  hardcodes a `lualatex`/`xelatex`/`pdflatex` engine enum. Custom templates now declare a
  source extension and a full compile command, so Typst (`typst compile`) registers the same
  way a custom LaTeX template does. Stock CV/cover letter templates stay LaTeX,
  unchanged. (#238)
- **Application-form fields as an optional third `/apply` artifact** - when a posting's
  application form asks screening questions, `/apply` can now offer a prep sheet of
  grounded answers alongside the CV and cover letter. Opt-in; the default two-document
  output never changes. (#212)
- **Confirmed facts write back to the profile** - when `/apply` or `/interview` surfaces a
  fact the user confirms (a skill, a date, a project detail), it is written back to the
  profile files in the same turn instead of being lost with the conversation. (#211)
- **CV methodology: in-progress qualifications and tenure-vs-output** - `05-cv-templates.md`
  gains explicit rules for stating in-progress certifications/degrees honestly and for
  checking claimed tenure against visible output (`framework_version` 1.2.1 -> 1.3.0). (#210)
- **Scraper flags mass-posting and recycled-listing patterns** - `/scrape` marks postings
  that look bulk-posted or recycled so they don't eat evaluation effort. (#207)
- **Retry contract pinned in CI** - all six portal CLIs now carry 429/5xx retry-backoff
  tests covering every fetch wrapper, so a silent regression in retry behavior trips
  CI. (#246)
- **README: the extension model, documented** - new Customization subsection "Extending the
  framework: portals, templates, criteria - and borrowing from other forks": the three
  extension points, the copy-one-folder pattern for borrowing a portal skill from another
  fork with a read-the-code-first checklist, and why there is deliberately no installer
  (the manual copy is the security model). Prompted by discussion #249.

### Fixed

- `/rank` shortlist and below-threshold tables include each posting's URL. (#236)
- `convert_salary_excel.py`: count/index columns pair by category name instead of
  adjacency (#219), standalone count columns store as counts (#230), and ragged rows from
  dimension-less spreadsheets no longer crash with an IndexError (#252).
- `cover.cls`: duplicate package imports removed and the `\ProvidesClass` name fixed to
  match the filename, silencing a class-name-mismatch warning. (#252)
- Portal CLI type-checking pinned to concrete `@types/bun` / `@bunli/*` versions to stop
  environmental CI type-drift. (#226)
- `freehire-search` points at freehire.me after the service's domain migration. (#229)
- `verify_pdf.py`'s missing-poppler error now includes per-OS install hints. (#252)

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
