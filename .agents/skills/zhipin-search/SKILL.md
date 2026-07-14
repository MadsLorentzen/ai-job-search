---
name: zhipin-search
version: 1.0.0
description: >
  Search BOSS直聘 (zhipin.com) — mainland China's largest tech/security/general job
  board — for job postings in any Chinese city. Requires an authenticated ego-browser
  session (the site is a login-gated, client-rendered SPA with no public API and a
  restrictive robots.txt); personal use only, low volume. Trigger phrases: BOSS直聘,
  zhipin, 找工作, 搜索BOSS直聘, boss直聘招聘, search zhipin, 招聘 上海/北京/杭州/苏州.
context: fork
allowed-tools: Bash(bun run skills/zhipin-search/cli/src/cli.ts *)
---

# BOSS直聘 (zhipin.com) Search Skill

Search live job listings from BOSS直聘 for mainland Chinese cities. Zero *npm* runtime
dependencies (`bun` + `node:child_process`), but — unlike this repo's other portal
skills — it is **not** a stateless HTTP client: zhipin.com has no public API and no
server-rendered HTML to parse (see `url-reference.md`), so this drives a real,
authenticated browser session via the `ego-browser` CLI instead of `fetch`.

## ⚠️ Personal use only — and an extra prerequisite

robots.txt disallows automated access to the query-string paths this needs
(`?query=`, `?city=`, and a catch-all `/*?*`), and the site is login-gated. This skill
doesn't fake or bypass that — it drives **your own real, logged-in browser session**
at low, interactive volume, the same access you'd have searching manually. Keep it
that way: a handful of searches, not a crawl. Don't use this commercially or for bulk
data collection. Run it on your own responsibility.

**Prerequisite this skill's siblings don't have**: `ego-browser` must be installed and
on `PATH`, and Chrome must be running with an active BOSS直聘 (求职者) login session.
If either is missing, `search`/`detail` fail with a clear error rather than silently
returning nothing.

## When to use this skill

- Search for job openings on BOSS直聘 in a supported Chinese city
- Get the full description (with the real, unmasked salary) of a specific posting

## Commands

### Search job listings

```bash
bun run skills/zhipin-search/cli/src/cli.ts search --location "<city>" [flags]
```

Key flags:
- `--location <city>` / `-l <city>` — **required.** A verified city name/alias (上海,
  北京, 杭州, 苏州, or `shanghai`/`beijing`/`hangzhou`/`suzhou`) or a raw 9-digit
  BOSS直聘 city code. See `url-reference.md` for how to verify and add a new one.
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Recommended.
- `--limit <n>` / `-n <n>` — cap total results emitted, **and how far `search` scrolls to find them**: it
  scrolls the results list until at least this many cards have loaded, up to a fixed safety ceiling. Omit to
  use a conservative default scroll target (45 cards) instead of just the first screenful.
- `--format json|table|plain` — default `json`.

**Salary is not available from `search`** — BOSS直聘 masks it in the list view
(returns `null`); use `detail` for the real figure. Not supported: `--jobage`
(no posting-date filter/field exists on this portal).

**Pagination is scroll-driven, not a flag.** BOSS直聘's result list is infinite-scroll, not
page-numbered — an earlier `--page` flag never did anything and has been removed. `search` now
scrolls automatically (bounded — a handful of steps, not a deep crawl, matching this skill's
personal-use-only posture) before scraping.

### Fetch full job detail

```bash
bun run skills/zhipin-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job id from `search` results (an opaque hash, e.g.
`cf386d859ead4dc40nF92NS0FVNX`). You may also pass a full `job_detail/...html` URL.
Returns the full description, experience/education requirements, address, and the
real (unmasked) salary.

## Usage examples

```bash
# Security-operations roles in Shanghai
bun run skills/zhipin-search/cli/src/cli.ts search -q "安全运营" -l "上海" --format table

# AI Agent security roles in Hangzhou, capped at 10 results
bun run skills/zhipin-search/cli/src/cli.ts search -q "AI Agent 安全" -l 杭州 --limit 10 --format table

# SOC/threat-intel roles in Beijing
bun run skills/zhipin-search/cli/src/cli.ts search -q "威胁情报" -l 北京 --format table

# Full detail (real salary included) for a specific posting
bun run skills/zhipin-search/cli/src/cli.ts detail cf386d859ead4dc40nF92NS0FVNX --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- Data comes from driving a real, authenticated Chrome tab via `ego-browser` — there
  is no HTTP fetch involved and no rate-limit/backoff logic the way `linkedin-search`
  has, because the failure mode here is "ego-browser/Chrome/login session isn't
  available," not "the server is rate-limiting an HTTP client."
- Description text is read via `.innerText` (not raw HTML) specifically because the
  site injects invisible anti-scraping watermark text mid-word into the raw markup —
  see `url-reference.md` for details. Even so, expect occasional minor garbling in a
  JD's text; verify against the live page before quoting a posting verbatim.
- Only 4 city codes are verified so far (上海/北京/杭州/苏州) — see
  `url-reference.md` for how to verify and add more without guessing.
