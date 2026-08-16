#!/usr/bin/env bun
// Self-contained CLI for searching jobs on iimjobs.com's public "gladiator" JSON API.
// India's premier board for MBA/PGDM, consulting, analytics, BI and management roles.
// No authentication, no API key, zero runtime dependencies — runs with just `bun`.
//
// Personal use only. This reads iimjobs.com's public endpoints; keep volume low
// (the site sets a 10s crawl-delay) and do not use it commercially or for bulk
// data collection. Run it on your own responsibility.

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

const HELP = `iimjobs-cli — search jobs on iimjobs.com (India: MBA / consulting / analytics / BI)

USAGE
  bun run src/cli.ts search --query "<keywords>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, or role). Recommended.
  --location, -l <text>   City name (e.g. "Bangalore", "Mumbai", "Pune") or a numeric loc id.
  --jobage <days>         Posted within N days (maps to the site's "posting" filter). Default: all.
  --minexp <years>        Minimum experience in years.
  --maxexp <years>        Maximum experience in years.
  --page <n>              1-indexed page (50 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "business intelligence" --format table
  bun run src/cli.ts search -q "data analyst" -l "Bangalore" --jobage 7 --format table
  bun run src/cli.ts search -q "power bi" -l "Pune" --minexp 3 --maxexp 8 --format plain
  bun run src/cli.ts search -q "strategy consulting" -l "Mumbai" --page 2
  bun run src/cli.ts detail 1712209 --format plain

Personal use only — uses iimjobs.com's public endpoints; keep volume low (10s crawl-delay).
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

    for (const name of ["jobage", "page", "limit", "minexp", "maxexp"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      minExp: flags.minexp !== undefined ? parseInt(flags.minexp as string, 10) : undefined,
      maxExp: flags.maxexp !== undefined ? parseInt(flags.maxexp as string, 10) : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    if (!opts.query && !opts.location) {
      process.stderr.write(
        JSON.stringify({
          error: "provide at least --query/-q (keywords) or --location/-l",
          code: "NO_QUERY",
        }) + "\n",
      )
      return 1
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
