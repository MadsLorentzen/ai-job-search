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

- **Commit-level upstream triage for forks** (#305). A new `tools/upstream_triage.py` walks the
  commits a fork is behind upstream and sorts them into "worth reviewing" vs "probably skip":
  cherry-picks already applied drop off on their own (matched by `git patch-id`, so ported work
  needs no bookkeeping), commits that only touch files the fork removed are set aside, and SHAs in
  a flat `.github/upstream-wontport.txt` stop resurfacing. It's the commit-history companion to
  `check_upstream_updates.py`'s version stamps - the two cross-reference each other in their output.
  Report-only by design: it prints ready-to-run `git cherry-pick` lines but never merges, pushes, or
  opens a PR, because on a fork "applies cleanly" isn't "correct". A `.github/workflows/upstream-watch.yml`
  runs it weekly into a rolling issue, guarded to no-op on the upstream template (pinned by a test) and
  scoped to the built-in `GITHUB_TOKEN` so it can never write outside its own fork. SETUP.md 8
  introduces both tools side by side. Offline tests cover patch-id matching, relevance filtering, the
  won't-port list, and the workflow guard. Thanks @anjolok1997.

- **`security_guards.py` now holds `.claude/settings.json` hooks to an allowlist** - the
  guard read `permissions.allow` and nothing else, so a `hooks` block in the same file
  passed silently. A hook is strictly more dangerous than a pre-approved permission: a
  permission pre-approves something Claude *may* choose to do, while a hook runs
  unconditionally when its event fires, with no prompt and no model decision in between.
  This is not hypothetical - it is the vector the Shai-Hulud worm used in its August 2026
  wave, planting a `SessionStart` hook in `.claude/settings.json` that executed on session
  start ([JFrog research](https://research.jfrog.com/post/shai-hulud-is-back-august/)).
  For a template thousands of people are invited to fork, that is the riskiest key in the
  file the guard already parses. `ALLOWED_HOOKS` ships empty (the template has no hooks),
  the check runs *before* the permissions shape guards so a malformed permissions block
  cannot return early and skip it, and unrecognised hook layouts fail closed rather than
  being skipped. Eight new `HookGuardTests` cases; 14 of the suite's 26 tests fail against
  the unpatched guard.

### Changed

- **`/add-portal` now specifies how a generated skill handles an API token** (#304) - the command
  could already scaffold a skill for a portal reachable only through a paid fetching
  service, but said nothing about the credential such a skill needs. It now checks for that
  case during reconnaissance and raises the per-call cost with the user *before*
  scaffolding. That check is explicitly subordinate to the `robots.txt`/terms decision
  in Step 2.4 - a paid fetching service never launders a refusal, and the credential
  path exists only for portals whose `robots.txt` permits access but whose bot
  protection blocks ordinary fetches. The portal-skill contract requires the token to come from a
  `<SERVICE>_API_TOKEN` environment variable (never a CLI flag, never a fixture) and to
  fail with `MISSING_CREDENTIALS` when unset; and such a skill's `SKILL.md` must carry a
  Setup section naming the service, the variable, and the billing. Spec only - no shipped
  portal needs a credential, so no existing skill changes. Thanks @Haseeb-1698.

- **`/add-portal`'s fetching contract line now states the honest-UA posture** - it read
  "browser User-Agent", predating the repo-wide shift to honest self-identification
  (#283, #277 and the portal-CLI fixes that followed). A generated skill now defaults to
  `Mozilla/5.0 (compatible; <portal>-cli/1.0)` - the convention every shipped portal CLI
  follows - and escalation to browser headers goes through the robots.txt gate in
  `09-web-research.md`, never the CLI's default.

- **CI discovers portal CLIs instead of hardcoding them** (#310). The `cli-checks` matrix
  is now emitted by a `discover-clis` job that finds every `.agents/skills/*/cli/package.json`,
  so a portal skill added with `/add-portal` gets its `typecheck` and `test` scripts run by CI
  automatically - on this repo and on any fork - without editing the workflow. Upstream
  coverage is unchanged (the discovered list on `master` is exactly the six shipped portals).
  `/add-portal`'s Register step now says so. Thanks @ayobamiseun.

### Fixed

- **`/upskill` reports are now gitignored at the path the skill actually writes them to.**
  The ignore rule `upskill/*.md` is rooted (a middle slash anchors a gitignore pattern to the
  repo root), but `/upskill` is a *skill*, and skills resolve bare relative paths against
  their own directory - the same observed behavior the `**/job_scraper/*` rules exist for.
  A report written to `.claude/skills/upskill/upskill/report-*.md` was therefore not ignored
  (`git check-ignore` confirms it on the unpatched tree), and an upskill report is the
  candidate's skill gaps and weaknesses measured against named employers - among the most
  sensitive files the workflow generates. The obvious widening, `**/upskill/*.md`, would have
  ignored the template's own `.claude/skills/upskill/SKILL.md` (the skill directory shares
  the name), so the new rule pins the report-file prefix instead: `**/upskill/report-*.md`.
  Added to `.gitignore` and `security_guards.py`'s `REQUIRED_IGNORE_RULES`, with a
  `check-ignore`-based test pinning both properties - reports ignored at both depths,
  `SKILL.md` still tracked - which presence checks alone cannot see.

- **Dropped the phantom `evaluated` value from `seen_jobs.json`'s status vocabulary** (#315).
  The schema block in the job-scraper skill documented `new/skipped/evaluated/ranked/expired`,
  but `evaluated` has had no writer and no reader since the initial release - `new`/`skipped`
  come from `/scrape`, `ranked`/`expired` from `/rank`, and nothing ever set or selected
  `evaluated`. Post-#269 the tracker owns all lifecycle state after drafting, so the value had
  no future role either; it is now removed rather than wired up. `/rank` Step 1's `--all`
  wording ("all non-applied entries") leaned on an `applied` status the schema deliberately
  lacks and now names what it means: entries of any status, minus the tracker exclusion set.
  Forks that wrote their own tooling against the documented vocabulary should note the value
  was never produced by any shipped command.

- **`/apply` archives the job posting while it still holds it** (#306). `/apply` drafted two
  documents and a tracker row from the full posting, then let the text die with the session;
  `/outcome` Step 3.2 tried to recover it by re-fetching a `source` URL the spec itself expects
  to be dead, and a posting pasted from an email or a PDF had no `source` to re-fetch at all.
  Step 6b item 7 now writes the posting verbatim to
  `documents/applications/<company>_<role>/job_posting.md`, never a re-fetch or a
  reconstruction from memory; an existing file is left alone (a re-application to the same
  company and role keeps the earlier posting) and named in the report. Step 0 and the `/scrape`
  path (`job-application-assistant` SKILL.md Step 1) retain the full posting text, not a
  summary. Pinned by `tests/test_apply_records_application.py`.

- **Tracker status enum defined once; `offer declined`/`no response` now reach the correct
  `/html-report` bucket and `/gmail-sync` correctly marks them final** (#298). The tracker
  CSV `status` column had no single authoritative definition. Six command files restated it
  independently with inconsistent spellings, producing two concrete bugs:

  - `/outcome` Step 4 wrote `no response` and `offer declined` (with spaces). `/html-report`
    Step 1 normalised only `no_response` / `offer_declined` (underscores), so any row written
    with spaces matched no bucket and was silently dropped from the rejection-rate denominator.
  - `/gmail-sync` Step 2 defined the "final" set with the space forms, so a row written with
    underscores was never recognised as final and the sync kept chasing closed applications.
  - `/html-report` included `interview_only` in the tracker bucket map; that value belongs to
    the archive `outcome.md` `Status:` field, not the CSV `status` column.

  Fix: a `## Tracker status vocabulary` block in `/outcome` (the only writer of the CSV)
  now defines the canonical set once with underscore spellings and the **Final** set by
  explicit list — everything else, `drafted` included, is **Open**. The legacy space
  spellings are the same values, not separate statuses: equally **Final**, and every rule
  that names one form applies to the other — readers must accept them on read, and never
  write them. Every reader that makes final/open decisions references that block (`/apply`
  Step 6b, `/interview` Step 0, `/gmail-sync` Step 2, `/html-report` Step 1, `/notion-sync`
  Steps 3-4). `/outcome` Step 4 writes `no_response` / `offer_declined`; `/notion-sync`
  normalises both forms to the canonical spellings before setting the Status property;
  `/html-report`'s bucket map loses `interview_only`, keeps both spellings, and gains a
  case-insensitive catch-all that maps unrecognised values to **Rejected/Closed** and names
  them once in the status breakdown. Pinned by `tests/test_tracker_status_vocab.py`.

  **Fork heads-up:** if your personalized `/outcome` adds `no response` or `offer declined`
  (space forms) to the tracker write path, swap them for the underscore forms. Existing rows
  keep working because every reader now accepts both spellings on read. If your Notion
  database already carries space-form Status options, they simply go unused — Notion never
  auto-removes select options.

## [1.4.0] - 2026-08-07

### Added

- **`--jobage-minutes` on linkedin-search for sub-day freshness windows** (#302) - LinkedIn
  filters its `f_TPR` parameter server-side at second granularity, so the CLI can now ask
  for postings from the last N minutes instead of whole-day windows only. Conflicts with
  `--jobage` are rejected explicitly (`CONFLICTING_AGE_FLAGS`). Useful for early-applicant
  freshness on high-volume searches; URL construction only, no parsing change.

- **README: video walkthrough link in Quick start** - The Next New Thing's hands-on
  walkthrough of the workflow (recorded August 2026), for newcomers who want to see the
  setup-to-application flow before reading. Docs only.

- **Spec-pinning tests for the Language Gate's `/rank` contract** (#278) - four regression
  guards in `tests/test_rank_command.py` pinning the `language_gate`/`language_note` fields
  through Steps 2-5 of `/rank`, including the Step 4 persistence rule that was live-debugged
  during #275 (vetoes reported in console output but `language_gate: null` on every persisted
  entry). Mirrors the existing `gaps`/`strengths` pinning pattern. No behavior change.

- **The jobnet and jobdanmark CLIs identify themselves on every API request** (#283) - their
  `apiFetch`/`apiPost` wrappers now send an explicit `User-Agent` (`jobnet-cli/1.0`,
  `jobdanmark-cli/1.0`) instead of Bun's anonymous default token, matching the honest
  self-identification jobindex already uses on `htmlFetch`. The new `user-agent.test.ts`
  suites assert the header on every request wrapper. No response behavior observed to
  change.

### Changed

- **The four Danish demo portals now ship disabled** (#288) - `jobindex-search`,
  `jobbank-search`, `jobdanmark-search`, and `jobnet-search` default to `enabled: false`,
  and `/setup`'s job-portals question now acts on the answer: it flips them to
  `enabled: true` when your market is Denmark, and leaves them off otherwise. Previously a
  non-Danish user's `/scrape` ran all four Danish boards by default, spending tokens
  fetching and filtering irrelevant listings. **Fork heads-up:** if you search the Danish
  market, set `enabled: true` in those four `SKILL.md` files after updating (or re-run
  `/setup --section search`); forks that already curated their portal set are unaffected.

### Fixed

- **The linkedin-search CLI identifies honestly** - its `User-Agent` was a full Chrome
  browser string, the last portal CLI still spoofing after #283 and the jobbank/jobdanmark
  fix. It now sends `Mozilla/5.0 (compatible; linkedin-search-cli/1.0)`, the same token
  format as every other portal. Verified live on both the search and detail endpoints:
  identical 200 responses with full content under the honest token.

- **A `.env` was committable** (`.gitignore`, `tools/security_guards.py`). `/add-portal`
  can generate a skill for a portal that only returns usable content through a paid
  fetching service, and such a skill reads an API token from the environment - but
  nothing stopped the `.env` holding that token from being committed. No shipped portal
  needs a credential, so upstream never hit this; a fork whose generated portals do hit
  it immediately. `.env` and `.env.*` are now ignored and pinned in
  `REQUIRED_IGNORE_RULES`, so the guard fails if the rule is ever dropped.

- **The robots gate did not fail closed** (`tools/robots_check.py`, #277). Found by an
  adversarial review run over the merged file, not by inspection. Both cases are pinned
  in `tests/test_robots_check.py` as FAIL-OPEN REGRESSIONs:

  - **A soft `200` granted permission.** A host answering `/robots.txt` with an HTML
    error page at status 200 produces a body that parses to zero rules, and zero rules
    read as "allowed" - so the browser-header retry ran on permission that was never
    given. A non-empty body carrying no recognised directive is now treated as
    unreadable. A genuinely empty file stays allow-all, per RFC 9309.
  - **`Disallow` patterns were never percent-decoded** while the request path was, so
    `Disallow: /foo%20bar` never matched `/foo bar` and the rule was silently skipped -
    a fail-open on any site that encodes its own rules.

- **`curl` argument hardening** (`tools/robots_check.py`). The curl argv had no `--`
  terminator before the URL. `gate()` rebuilds the target as `scheme://host/robots.txt`
  before calling `_fetch`, so the gate path was never exposed; this is hardening for
  direct callers, with a test pinning the terminator, that a dash-leading argument fails
  closed end to end, and that `gate()` never passes a caller-supplied URL through to
  curl. `--max-redirs 5` is set explicitly rather than left to curl's default.

- **Negative and fractional filter flags are rejected in the Danish portal CLIs** (#281) -
  `--jobage` (jobindex), `--radius` (jobnet), `--category`/`--jobtitle-id` (jobdanmark), and
  `--company` (jobbank) now validate as positive integers, completing the `page`/`limit`/
  `per-page` tightening from #191. Some portals silently ignore invalid filter values and
  return unfiltered results, so a mistyped ID produced wrong results instead of an error.
- **The upstream checker reports files missing from the upstream ref instead of a silent
  `[OK]`** (#282) - if upstream renames or deletes a tracked framework file, a fork's
  `check_upstream_updates.py` now lists it under a `[WARNING]` summary instead of skipping
  it and printing a false all-clear.
- **`09-web-research.md` is now tracked by the upstream checker** - the file shipped in
  #277 but was never added to `FRAMEWORK_FILES`, so forks got no signal when it changed.
- **jobbank and jobdanmark CLIs identify honestly** - jobbank's `User-Agent` was a full
  Chrome browser string and jobdanmark's detail command sent a bare `Mozilla/5.0`; both now
  use the `Mozilla/5.0 (compatible; <portal>-cli/1.0)` token the other portal CLIs use,
  matching the identification posture settled in #277. Verified live: both portals serve
  identical responses to the honest token.

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

- **`/apply` now records the application in the tracker** - the flagship command wrote a CV
  and a cover letter to disk and then wrote nothing to `job_search_tracker.csv`, so a drafted
  and submitted application was invisible to `/gmail-sync`, `/html-report`, `/notion-sync`,
  `/interview`, `/upskill` aggregate mode, and to `/rank`'s dedup exclusion - and the safety
  net that would have caught it (`/gmail-sync`) refuses to create missing rows, so nothing
  detected the loss. A new Step 6b appends a `drafted` row carrying the two document paths,
  the fit rating and the posting URL, reusing `/outcome`'s exact header so the two commands
  cannot diverge; re-running `/apply` updates that row rather than duplicating it, unless every
  matching row holds a final status, in which case a second application to the same role gets
  its own row. The same
  step is mirrored into `job-application-assistant` because `/scrape` Step 5 routes straight
  into the skill (`framework_version` 1.2.0 -> 1.3.0), and `/scrape` Step 6 now defers to it
  instead of adding a row of its own. `seen_jobs.json` is deliberately left alone. **Forks:**
  the bump means `check_upstream_updates.py` will flag the skill - reconcile the new Step 3b
  (and Step 6b in `apply.md`) into your personalized copies rather than skipping the flag.

  **`drafted` is introduced into the tracker status vocabulary**, and every reader that
  meant *submitted* now says so. These readers define "open" by exclusion from the final
  statuses, so a new non-final value would otherwise have joined all of them silently:
  `/outcome`'s follow-up branch no longer drafts a chase email for an application that was
  never sent, `/gmail-sync` no longer reports unsent drafts as stale, `/notion-sync` leaves
  "Applied on" empty for them and says "not yet submitted" in the page body rather than
  calling drafts submitted documents, and `/html-report` gains a sixth **Drafted** bucket
  kept out of the funnel, the rejection rate and the headline count. `/outcome` Step 4
  overwrites `date` with the submission date when a row leaves `drafted`, so the column
  keeps meaning "applied on".

  **`/gmail-sync` deliberately keeps searching for drafted rows.** `/apply` drafts but the
  user submits, and forgetting to run `/outcome` afterwards is the failure this issue is
  about. An employer reply arriving against a row still marked `drafted` is how that gets
  caught, so those rows stay in the search set, the application acknowledgement is promoted
  from noise to a `drafted` -> `applied` signal (it is the one email that proves a hand
  submission, and it arrives within a day of it), and an approved match corrects the `date`
  as well as the status. Only the staleness check skips them, since nothing was sent. (#269)

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

[Unreleased]: https://github.com/MadsLorentzen/ai-job-search/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/MadsLorentzen/ai-job-search/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/MadsLorentzen/ai-job-search/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/MadsLorentzen/ai-job-search/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/MadsLorentzen/ai-job-search/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/MadsLorentzen/ai-job-search/releases/tag/v1.0.0
