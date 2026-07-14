# zhipin-cli

CLI for searching jobs on **BOSS直聘** (zhipin.com), mainland China's largest tech/security
job board.

**Data source**: no public API, no parseable server HTML — zhipin.com is a login-gated,
fully client-rendered SPA. This CLI drives a real, authenticated browser session via the
[`ego-browser`](https://www.npmjs.com/package/ego-browser) CLI instead of `fetch`.
**Authentication**: required — Chrome must be running with an active BOSS直聘 (求职者)
login session; `ego-browser` reuses that session.
**Dependencies**: zero *npm* runtime dependencies (`bun` + `node:child_process`), but this
skill has a real external dependency the other portal skills don't: the `ego-browser` binary
on `PATH` and a live, logged-in Chrome.

> **Personal use only.** robots.txt disallows automated access to the query-string search
> paths this needs (`?query=`, `?city=`, and a catch-all `/*?*`). This tool doesn't evade
> that with a fake browser fingerprint — it drives your own real, authenticated session at
> low, interactive volume, the same way you'd search manually. Keep it that way: a handful
> of searches, not a crawl. Run on your own responsibility.

## Installation

```bash
cd .agents/skills/zhipin-search/cli
bun install   # only installs TypeScript dev types
```

You also need `ego-browser` installed and configured, and Chrome open with you logged into
BOSS直聘 as a candidate (求职者). If `ego-browser` isn't on `PATH`, `search`/`detail` fail
with a clear `SEARCH_FAILED`/`DETAIL_FAILED` error explaining that.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings (`--location` required). Salary is **not** available here — see below. |
| `detail` | Fetch full detail for a single listing, including the real salary. |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Security-ops roles in Shanghai
bun run src/cli.ts search -q "安全运营" -l "上海" --format table

# AI Agent security roles in Hangzhou, capped at 10 results
bun run src/cli.ts search -q "AI Agent 安全" -l 杭州 --limit 10 --format table

# Full detail (real salary included) for one posting
bun run src/cli.ts detail cf386d859ead4dc40nF92NS0FVNX --format plain
bun run src/cli.ts detail https://www.zhipin.com/job_detail/cf386d859ead4dc40nF92NS0FVNX.html --format plain
```

See `../SKILL.md` for the full flag reference and `../url-reference.md` for the DOM
selectors and portal quirks this relies on.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--location` | `-l` | **Required.** A verified city name/alias (上海, 北京, 杭州, 苏州, or shanghai/beijing/hangzhou/suzhou) or a raw 9-digit BOSS直聘 city code. |
| `--query` | `-q` | Keywords (title / skill / role). Recommended. |
| `--limit` | `-n` | Cap results emitted, and how far `search` scrolls to find them (see below). |
| `--format` | | `json` \| `table` \| `plain`. |

Not supported: `--jobage` (no posting-date filter or field exists in this portal's UI),
`--remote` (no workplace-type filter observed).

**Scroll-driven pagination.** BOSS直聘's result list is infinite-scroll, not page-numbered
(an earlier `--page` flag never worked and has been removed). `search` scrolls the page,
in bounded steps, until either `--limit` cards have loaded, the list stops growing, or a
low fixed step ceiling is hit — never an unbounded crawl, matching this skill's
personal, low-volume use only posture. Omit `--limit` to use a default scroll target of
45 cards.

## Why this isn't a plain `fetch` CLI

An unauthenticated request to the search URL returns an empty `<div id="app">` shell (see
`url-reference.md`) — there's no HTML to parse and no discovered JSON API. Real listings only
exist after the page's JS executes inside a session that's actually logged in. Rather than
reverse-engineer and replay that login flow (which would mean embedding session cookies in a
committed script — a security and maintenance liability), this CLI shells out to
`ego-browser nodejs`, which drives your own already-authenticated Chrome tab and reads the
rendered DOM back as JSON.
