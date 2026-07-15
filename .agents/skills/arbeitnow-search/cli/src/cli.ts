#!/usr/bin/env bun
// Self-contained CLI for the free Arbeitnow job board API (Germany; tech/startup/
// English-speaking focus). No API key, zero runtime dependencies.
//
// The API ignores server-side filter params (verified), so this CLI fetches pages
// (100 jobs each, newest first) and filters client-side. Page scans are capped to
// keep request volume low — the API asks not to be abused.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { MAX_PAGES } from "./helpers.js"

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

const HELP = `arbeitnow-cli — search the free Arbeitnow job board (Germany, tech/startup focus)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keyword filter (title, tags, company, description). Client-side.
  --location, -l <text>   Location substring filter (e.g. "Berlin", "Munich").
  --remote                Only remote jobs.       --onsite   Only non-remote jobs.
  --jobage <days>         Only jobs posted within the last N days.
  --pages <n>             API pages to scan, 100 jobs each (default 3, max ${MAX_PAGES}).
  --page <n>              1-indexed start page. Default 1.
  --limit, -n <n>         Cap results emitted.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q developer --remote --format table
  bun run src/cli.ts search -q python -l Berlin --jobage 14 --format table
  bun run src/cli.ts search -q marketing --pages 10 --limit 20 --format table
  bun run src/cli.ts detail senior-developer-berlin-123456 --format plain

Data source: free public API (arbeitnow.com/api/job-board-api), no key. Keep volume low.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
    const val = parseInt(raw as string, 10)
    if (isNaN(val)) {
      process.stderr.write(JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n")
      return null
    }
    return val
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    if (flags.remote === true && flags.onsite === true) {
      process.stderr.write(JSON.stringify({ error: "--remote and --onsite are mutually exclusive", code: "BAD_ARG" }) + "\n")
      return 1
    }

    let jobage: number | undefined
    let page = 1
    let pages = 3
    let limit: number | undefined

    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = Math.max(0, v)
    }
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, v)
    }
    if (flags.pages !== undefined) {
      const v = parseIntFlag("pages", flags.pages)
      if (v === null) return 1
      pages = Math.min(Math.max(1, v), MAX_PAGES)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      remote: flags.remote === true ? true : flags.onsite === true ? false : undefined,
      jobage,
      page,
      pages,
      limit,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <slug|url>", code: "NO_ID" }) + "\n")
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
