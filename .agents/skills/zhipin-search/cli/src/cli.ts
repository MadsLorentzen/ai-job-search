#!/usr/bin/env bun
// Self-contained CLI for searching jobs on BOSS直聘 (zhipin.com), mainland China's
// largest tech/security job board. Unlike linkedin-search, this is NOT a stateless
// HTTP client: zhipin.com is a login-gated, fully client-rendered SPA with no public
// API, so this drives a real authenticated browser session via the `ego-browser`
// CLI, reusing your own logged-in Chrome profile — the same access a human doing
// this search manually would have.
//
// Personal use only. robots.txt disallows automated access to the query-string
// search paths this needs; keep volume low (a handful of searches, not a crawl) and
// do not use this commercially or for bulk data collection. Run it on your own
// responsibility. Requires: ego-browser installed and configured, Chrome running
// with an active BOSS直聘 (求职者) login session.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `zhipin-cli — search jobs on BOSS直聘 (zhipin.com), mainland China

USAGE
  bun run src/cli.ts search --location "<city>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --location, -l <text>   City. REQUIRED. A known city name (上海/北京/杭州/苏州, or
                          shanghai/beijing/hangzhou/suzhou) or a raw 9-digit BOSS直聘
                          city code. See helpers.ts CITY_CODES for the verified list
                          — add more only after verifying them (url-reference.md).
  --query, -q <text>      Keywords (job title, skill, or role). Recommended.
  --limit, -n <n>         Cap results emitted, and how far \`search\` scrolls to
                          find them: it scrolls the results list until at least
                          this many cards have loaded (bounded by a low, fixed
                          safety ceiling). Omit to use a conservative default
                          scroll target (45 cards) instead of just the first
                          screenful.
  --format <fmt>          json (default) | table | plain.

NOT SUPPORTED: --jobage (posting age). BOSS直聘's search UI exposes no posting-date
filter and listings don't show a post date, so there's nothing to map this to.

SALARY NOTE: the search-results list masks salary (canvas overlay; DOM shows a
literal "-K" placeholder) — \`search\` returns salary: null. Only \`detail\` shows the
real, unmasked salary.

EXAMPLES
  bun run src/cli.ts search -q "安全运营" -l "上海" --format table
  bun run src/cli.ts search -q "AI Agent 安全" -l 杭州 --limit 10 --format table
  bun run src/cli.ts detail cf386d859ead4dc40nF92NS0FVNX --format plain
  bun run src/cli.ts detail https://www.zhipin.com/job_detail/cf386d859ead4dc40nF92NS0FVNX.html --format plain

Personal use only — requires ego-browser + a logged-in BOSS直聘 Chrome session; keep
volume low (robots.txt disallows automated access to these paths).
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd === "search") {
    const location = typeof flags.location === "string" ? flags.location : undefined
    if (!location) {
      process.stderr.write(
        JSON.stringify({
          error: 'the --location/-l flag is required (e.g. -l "上海", -l shanghai, or a raw city code)',
          code: "NO_LOCATION",
        }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
        )
        return null
      }
      return val
    }

    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
    }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main().then((code) => process.exit(code))
