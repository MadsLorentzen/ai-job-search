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

- **Spec-pinning tests for the Language Gate's `/rank` contract** (#278) - four regression
  guards in `tests/test_rank_command.py` pinning the `language_gate`/`language_note` fields
  through Steps 2-5 of `/rank`, including the Step 4 persistence rule that was live-debugged
  during #275 (vetoes reported in console output but `language_gate: null` on every persisted
  entry). Mirrors the existing `gaps`/`strengths` pinning pattern. No behavior change.

### Fixed

- **A `WebFetch` 403 is no longer treated as a dead posting** - `WebFetch` sends a bot user
  agent, and many bank and corporate sites answer it with HTTP 403 while serving the same
  page to a browser normally. Every command read that as "page unavailable" and degraded
  silently instead of failing loudly: `/rank` marked live postings `expired`, `/apply` fell
  back to search-result snippets or to vague cover-letter prose, and `/scrape` stored
  listing-page `#fragment` URLs that fetch fine but return unrelated jobs, breaking every
  later run on that entry. New `09-web-research.md` (`framework_version` 1.0.0) is the
  single reference: the trust boundary, a curl browser-header retry with a tag-stripping
  extractor, a four-step escalation order, the login-wall case, why the employer's own
  careers posting beats an aggregator listing (the requisition ID and the grade survive
  there), and the rule that a search snippet is a lead rather than a source. Wired into
  `/apply`, `/rank`, `/interview`, `/outcome`, `/notion-sync`, the job-scraper skill, and
  writing-style rule 5 (`03-writing-style.md` 1.1.0 to 1.2.0).

  **The retry is gated on `robots.txt`.** `WebFetch` identifies itself as `Claude-User`
  and honors `robots.txt`, so a 403 means either a WAF default on a site whose published
  policy allows access, or a site that has actually declined. New `tools/robots_check.py`
  tells them apart and the escalation runs it before retrying: a disallow for `*` or
  `Claude-User` skips the retry entirely and goes straight to finding the employer's own
  posting. The rule is stated in the file so later edits do not erode it - *the retry
  exists to get past bot-filtering firewalls on sites whose robots.txt permits access; it
  is never used to override a site that has said no.* Two findings are pinned by
  `tests/test_robots_check.py` (15 offline cases): the WAF usually blocks `robots.txt`
  itself, so the policy is read as a browser when the honest request is refused and then
  obeyed strictly; and `urllib.robotparser` cannot be used, because it ends a record at a
  blank line and matches in file order, which reads a real-world policy as
  "everything allowed".

## [1.3.0] - 2026-08-03

### Added

- **Language Gate** - no dimension or gate anywhere in the framework checked a posting's
  language requirements against what the candidate actually speaks (not a Scoring Dimension,
  not a `/scrape`/`/rank` field, nothing for `/apply`'s existing generic language detection
  to report to). Adds that check, structured like the existing Eligibility Gate, on a new
  structured `Languages` table in CLAUDE.md / `01-candidate-profile.md` (`/setup` asks, or
  infers it from a CV/LinkedIn export): a posting requiring a language you haven't declared
  at all is a hard **FAIL**; one requiring a higher level than you declared in a language you
  *do* work in is **FLAG**, not an auto-reject, so borderline cases (a strict "fluent" bar vs.
  your own B1/B2) get your judgment instead of a silent drop; a requirement at or below your
  declared level is a clean **PASS**. Wired through `/scrape`, `/rank`, and `/apply`, with
  `language_gate`/`language_note` persisted into `seen_jobs.json` alongside the existing
  `location` veto so a re-read of the file (or a future debugging session) can recover why a
  job did or didn't make the shortlist.

### Fixed

- **CV date fields now use ASCII hyphens, so the PDF text layer extracts cleanly** - the
  stock template wrote date ranges as `[YYYY--YYYY]`, and on the repo's mandated `lualatex`
  toolchain the `--` en-dash ligature extracts from the PDF as U+FFFD (`�`). The stock
  template therefore failed the ATS checklist's own "no `�` replacement characters" item on
  *every* date field, and did so silently: the rendered page looks correct, and no existing
  check inspected the extracted text. `cv/main_example.tex` now uses `[YYYY-YYYY]` and
  `[YYYY-Present]`, and `05-cv-templates.md` documents the failure mode and the check that
  catches it (`framework_version` 1.3.0 to 1.4.0). The two-page layout budget is unaffected.

  **Fork reconciliation note.** The five changed lines in `cv/main_example.tex` are the
  `\cventry` date fields - three under Professional Experience, two under Education -
  precisely the lines every fork personalizes. Rebasing forks should expect conflicts there,
  resolve them in favour of *their own* dates, and then apply the same `--` to `-` change by
  hand. To find remaining instances across your own CV variants:

  ```
  grep -rn '\\cventry{[^}]*--' cv/
  ```

  Verify afterwards by extracting the text layer and checking the date lines specifically:
  `pdftotext -layout <file>.pdf - | grep '�'` - none of the hits may be a date field. (On
  the stock template two benign hits remain either way: the decorative separators on the
  contact and award lines, which are unrelated to dates and predate this fix.)

- `tools/convert_salary_excel.py` now parses localized numeric string cells - Excel
  exports that store numbers as text (a Danish `"108,5"`, `"1.234,5"`, or space-separated
  thousands) previously hit `float()`'s `ValueError` and were silently dropped from
  `salary_data.json`. The ambiguous single-comma-plus-three-digits pattern (`"1,234"`,
  thousands in one locale and a decimal in another) is deliberately skipped rather than
  guessed, preserving the old safe behaviour for the one case that cannot be
  disambiguated. (#272)
- `tools/check_upstream_updates.py` compares the template-repo slug case-insensitively -
  GitHub serves repository paths case-insensitively, so a clone made from a lowercased
  URL was a legitimate direct clone that nonetheless triggered #265's fork-vs-self
  warning. (#273)

### Changed

- SETUP.md section 8 now shows the first-time `git remote add upstream ...` command
  before telling you to `git fetch upstream`, which previously failed on any clone of a
  personal fork with no explanation of the missing remote. (#274)

### Security & privacy

- **The gitignore guard now covers every personal-output rule** - `security_guards.py`
  additionally requires the ignore rules for Gmail sync state (`gmail_sync/`), generated
  dashboards (`reports/`), upskill reports (`upskill/*.md`), Notion sync state
  (`**/job_scraper/notion_sync.json`), pasted postings (`documents/postings/**`), scraper
  markdown output (`**/job_scraper/*.md`), and behavioral-report / LinkedIn-profile PDFs.
  With these, every `.gitignore` rule outside the guard's required list is build tooling
  noise, so any future weakening of the personal-data boundary fails CI. All rules were
  already present in `.gitignore`; the guard now enforces the full set. (#271)

## [1.2.0] - 2026-08-01

### Added

- **`/rank` now persists `strengths` and `gaps` into `seen_jobs.json`** - Step 2's scoring
  agents already produced both arrays per job; Step 4 previously kept only `rank_score`,
  `rank_verdict`, and `rank_date`, so the honest per-posting findings were printed once in
  Step 5 and then discarded. Both arrays are now stored verbatim and replaced (never
  accumulated) on `--all` re-ranks, so downstream consumers of `seen_jobs.json` can read
  real triage findings instead of re-deriving them. See
  [discussion #258](https://github.com/MadsLorentzen/ai-job-search/discussions/258).
- **`/upskill` aggregate mode now ingests `/rank`'s recorded gaps** - previously it only
  read `job_search_tracker.csv` and *guessed* required skills from the `role`/`sector`/
  `notes` columns, even though `/rank` had already fetched and scored postings that never
  made it into the tracker. Aggregate mode now also reads ranked entries
  (`rank_score >= 45`) from `job_scraper/seen_jobs.json`, dedupes them against tracker rows
  on case-insensitive company+role, and prefers a job's recorded `gaps` over an inferred
  skill list wherever both exist. The heatmap's Gap Source column now shows the
  recorded-vs-inferred split per skill, and the report header states how many jobs came
  from each source. Depends on #263 (`/rank` persisting `gaps`/`strengths`); see
  [discussion #258](https://github.com/MadsLorentzen/ai-job-search/discussions/258).

### Security & privacy

- **SETUP.md no longer calls a fork "private working space"** - forks of public GitHub
  repositories are always public, so that wording invited exactly the personal-data
  exposure it seemed to rule out. Section 8 now states the fork-is-public fact plainly and
  documents the safe alternative (a private repository with this repo as `upstream`), and
  `/setup` ends with a matching privacy note the moment profile data first lands in
  tracked files. Prompted by
  [discussion #266](https://github.com/MadsLorentzen/ai-job-search/discussions/266).
- **The gitignore guard now covers two more personal-data rules** - `security_guards.py`
  requires `cover_letters/Cover_*.*` (the uppercase cover-letter naming variant `/apply`
  recognizes) and `cv/*.txt` (ATS text extractions of tailored CVs) in `.gitignore`, so a
  future change weakening either rule fails CI instead of silently making personal files
  trackable. Both rules were already present in `.gitignore`; only the guard lagged.

### Fixed

- `tools/check_upstream_updates.py` no longer reports a false "up to date with upstream"
  when it silently falls back to a fork's own `origin` remote - the default state of a
  plain fork clone, where the script compared the fork against itself and could never
  detect upstream updates. It now warns that the fallback remote is not the template repo,
  shows the `git remote add upstream` command to fix it, and names the ref it actually
  compared against. (#265)
- Removed the vestigial `cover_letters/OpenFonts/cover.cls` - an unreferenced remnant of
  the original font bundle that, since #252's class rename, ambiguously declared the same
  `cover` class as the real `cover_letters/cover.cls`.
- Added regression tests pinning #252's ragged-row bounds fix in
  `tools/convert_salary_excel.py` (dimension-less workbooks read in `read_only` mode
  yield rows shorter than the header).

### Changed

- CONTRIBUTING's "run what CI runs" list is now complete - it previously omitted
  `tools/security_guards.py` and the exact `unittest` invocation, the precise checks a
  contributor PR had already failed on. Prompted by
  [issue #262](https://github.com/MadsLorentzen/ai-job-search/issues/262).

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
