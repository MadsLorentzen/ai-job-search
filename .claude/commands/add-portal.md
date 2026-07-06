# /add-portal - Generate a Job-Portal Search Skill for Your Local Market

You are helping the user build a job-portal search skill for a job board in their market. The repo ships worked examples of the pattern (four Danish portals plus the country-agnostic `linkedin-search`), and the README invites users elsewhere to build equivalents — this command turns that invitation into a guided workflow: investigate the portal, scaffold the skill from the canonical structure, and test-run a live query before registering anything.

The generator is **country-agnostic**: it works for any portal in any market and language. The skills it produces are typically market-specific and live in the user's fork (per repo policy, country-specific portal skills are not merged upstream — the generator is the upstream feature, its output is yours).

`$ARGUMENTS` may contain a subcommand, a portal URL, or nothing.

Follow these steps **in order**.

---

## Step 0: Parse Arguments

- If `$ARGUMENTS` contains `--list`: use Glob with `.agents/skills/*/SKILL.md`, print a table of installed portal skills (name, market from the description, data source from `url-reference.md`), and stop.
- If `$ARGUMENTS` contains a URL: treat it as the portal URL and carry it into Step 1.
- Otherwise: start the interview at Step 1.

---

## Step 1: Interview - Portal Basics

Ask the user (skip anything already answered by `$ARGUMENTS`):

1. **Portal URL** - the job board's public site (e.g. `https://www.seek.com.au`, `https://www.stepstone.de`).
2. **Skill name** - kebab-case, suffixed `-search` (e.g. `seek-search`, `stepstone-search`). Must not collide with an existing folder in `.agents/skills/`.
3. **Market and language** - which country/region the portal covers and what language its postings use. This drives the trigger phrases in `SKILL.md` (include local-language terms like the Danish skills do: "ledige stillinger", "jobsøgning").
4. **A realistic test query** - a job title or skill the user would actually search for, used for the live test in Step 4.

---

## Step 2: Investigate the Portal

Do reconnaissance before writing any code. Use WebFetch (or `curl` via Bash) on the portal:

1. **Find the search URL pattern.** Load the portal's search page, run a search in the URL bar mentally or via fetch, and identify: the search endpoint, the query parameter, and any parameters for location, posting age, and pagination. Prefer a JSON API if one backs the site (check for `/api/` XHR endpoints in the page source); otherwise plan to parse the HTML results page.
2. **Fetch one search-results response** for the test query and identify the per-result fields: **id, title, company, location, posting date, and URL**. For HTML, note the class names / attributes that anchor each field. For JSON, note the field paths.
3. **Find the detail-page pattern** - the URL that returns a single posting's full description, and where the description, deadline, employment type, and apply link live in it.
4. **Check access requirements and terms.**
   - Fetch `robots.txt` and check whether the search/detail paths are disallowed.
   - If the portal requires login/authentication to view listings, **stop**: this pattern only works on public pages. Tell the user and suggest checking whether the portal has an official API.
   - If robots.txt disallows the paths or the portal's terms prohibit automated access, tell the user plainly and let them decide whether to proceed for personal use. If they proceed, the generated `SKILL.md` **must** carry a prominent personal-use-only warning (copy the tone of `linkedin-search`'s "⚠️ Personal use only" section: keep volume low, no commercial or bulk use, own responsibility).

Record everything you found - endpoints, parameters, field anchors, quirks - you will write it into `url-reference.md` in Step 3.

---

## Step 3: Scaffold the Skill

**Canonical reference:** read `.agents/skills/linkedin-search/` before generating - it is the zero-dependency worked example of this exact structure. Copy its architecture, not its LinkedIn-specific parsing.

Create `.agents/skills/<name>/` with:

```
<name>/
├── SKILL.md              # Skill definition with trigger phrases
├── url-reference.md      # Endpoint documentation from Step 2
└── cli/
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── src/
    │   ├── cli.ts        # Arg parsing, help text, command dispatch
    │   ├── helpers.ts    # Fetch with backoff, parsers, error writer
    │   └── commands/
    │       ├── search.ts
    │       └── detail.ts
    └── tests/
        └── helpers.ts    # runCLI + parseJSON test utilities (copy from jobindex-search)
```

### The portal-skill contract (every generated skill MUST honor this)

These conventions are what make portal skills interchangeable for `/scrape` and for users reading any skill's docs:

- **Commands:** `search` and `detail <id|url>`.
- **Search flags:** `--query`/`-q`, `--jobage <days>` (posting age; map to the portal's parameter, note in SKILL.md if unsupported), `--page <n>` (1-indexed), `--limit <n>` (client-side cap), `--format json|table|plain` (default `json`). Add `--location`/`-l` if the portal supports location as a parameter; if it only supports location inside the keyword query, document that in SKILL.md the way `jobindex-search` does ("include the city in `--query`").
- **JSON output shape:** `{ "meta": { "count": ..., "page": ... }, "results": [...] }` where each result has at least `id`, `title`, `company`, `location`, `date`, `url` (missing values are `null`, never omitted).
- **Errors:** written to **stderr** as `{ "error": "...", "code": "..." }`, exit code `1`. Never write errors to stdout.
- **Fetching:** browser User-Agent, exponential backoff with jitter on 429/5xx (max ~6 retries), `""`/`null` on 404 rather than a crash.
- **HTML parsing:** split the response into per-result chunks and parse each independently, so one malformed card cannot break the rest (see `parseJobCards` in `linkedin-search/cli/src/helpers.ts`).
- **Dependencies:** default to **zero runtime dependencies** (plain `bun` + `fetch` + regex parsing) like `linkedin-search` - `bun install` should only pull dev types. Only add a parsing library if the portal's markup genuinely defeats chunked regex parsing, and say so in the README.

### File specifics

- **`SKILL.md` frontmatter:** `name`, `version: 1.0.0`, a `description` written for skill triggering - it must name the portal, the market, and include trigger phrases in English **and** the market's language; `context: fork`; `allowed-tools: Bash(bun run skills/<name>/cli/src/cli.ts *)`.
- **`SKILL.md` body:** what the skill searches, the personal-use warning if Step 2 found terms restrictions, command reference with flags, 4-6 usage examples using the user's market (real cities, realistic roles), output-format table, and a Notes section recording portal quirks found in Step 2.
- **`url-reference.md`:** the endpoints, parameters table, and response-structure notes from Step 2 - this is the file a future maintainer needs when the portal changes its markup.
- **`package.json`:** name `<portal>-cli`, `"type": "module"`, scripts `start`, `test` (`bun test --timeout 30000`), and `typecheck` (`tsc --noEmit`); dev-only dependencies in the zero-dependency default.
- **`tests/`:** copy `runCLI`/`parseJSON` from `jobindex-search/cli/tests/helpers.ts`, then add a small live smoke-test file: `search` with the test query returns exit code 0 and ≥1 result with non-null `id`/`title`/`url`; a bogus flag or missing required arg exits 1 with a JSON error on stderr.

---

## Step 4: Test-Run a Live Query (MANDATORY)

Never register a portal skill that has not returned real results. Markup assumptions from Step 2 routinely miss quirks that only show up live.

1. Install dev types and typecheck:
   ```bash
   cd .agents/skills/<name>/cli && bun install && bun run typecheck
   ```
2. Run the live search with the user's test query:
   ```bash
   bun run src/cli.ts search -q "<test query>" --limit 5 --format table
   ```
3. Verify the results are real and complete: titles and companies are populated (not empty strings or HTML fragments), URLs resolve to the portal, dates parse. If fields come back null or garbled, fix the parsers in `helpers.ts` and re-run. Iterate until clean.
4. Take one `id` from the results and run `detail`:
   ```bash
   bun run src/cli.ts detail <id> --format plain
   ```
   Verify the description is readable text (entities decoded, tags stripped, paragraph breaks preserved).
5. Run the test suite: `bun run test`.
6. Keep volume low during iteration - a handful of requests, not a crawl. If the portal rate-limits you mid-test, back off and tell the user.

Do not proceed to Step 5 until search, detail, and tests all pass.

---

## Step 5: Register

1. Ask whether the user wants the new portal added to their `/scrape` search strategy. If yes, add the portal's site to the relevant query categories in `.claude/skills/job-scraper/search-queries.md` (site-specific queries, like the existing `jobindex.dk` entries) so `/scrape` includes it.
2. Remind the user to add the install line for their own records if they maintain a fork README:
   ```bash
   cd .agents/skills/<name>/cli && bun install && cd ../../../..
   ```
   (Skip if the skill is zero-dependency and they don't care about typecheck types.)
3. Note that the skill auto-triggers from its `SKILL.md` description - no other wiring is needed.

---

## Step 6: Confirm

Present a summary:

> **Portal skill `<name>` generated and verified.**
>
> - Files: `.agents/skills/<name>/` (SKILL.md, url-reference.md, CLI with tests)
> - Live test: `search "<test query>"` returned <N> results; `detail` verified on one posting
> - Data source: <endpoint summary>; <personal-use warning noted, if applicable>
>
> Try it: `bun run .agents/skills/<name>/cli/src/cli.ts search -q "<test query>" --format table`
>
> Per upstream policy, market-specific skills like this live in your fork rather than being PR'd upstream. If the portal changes its markup later, `url-reference.md` records the parsing anchors to update.

---

## Design Principles

- The generator is country-agnostic; its output is market-specific and stays in the user's fork. This matches the repo policy that upstream stays a universal template.
- Investigation before scaffolding: the command never generates parsers from guesses - Step 2 fetches real responses first, and Step 4 verifies against live data before anything is registered.
- The portal-skill contract keeps every generated skill interchangeable with the shipped ones: same commands, same flags, same output shape, same error convention.
- Zero runtime dependencies by default, matching `linkedin-search` - a portal skill should run on a fresh clone with nothing but `bun`.
- Access rules are surfaced, not silently bypassed: auth-walled portals are declined, robots.txt/ToS restrictions are reported to the user, and restricted portals get a prominent personal-use-only warning in the generated skill.
