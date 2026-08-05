#!/usr/bin/env bun
// Self-contained CLI for searching jobs on The Muse's public API.
// Zero runtime dependencies — runs anywhere `bun` is available.
//
// The Muse publishes this API for public use and requires no key for the
// endpoints used here. Keep request volume reasonable.

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

const HELP = `themuse-cli — search jobs on The Muse (US-focused, cross-company)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords. NOTE: filtered CLIENT-SIDE — The Muse's public
                          API has no free-text parameter. Narrow with --category /
                          --location first, then use -q to refine.
  --location, -l <text>   Location, e.g. "New York, NY", "Austin, TX". "Remote"
                          is mapped to The Muse's "Flexible / Remote" bucket.
  --category <text>       Server-side filter, e.g. "Software Engineering",
                          "Data Science", "Product Management".
  --level <text>          Server-side filter, e.g. "Entry Level", "Mid Level",
                          "Senior Level", "Management".
  --company <slug>        Server-side filter by company short name, e.g. "avalabs".
  --jobage <days>         Posted within N days (client-side on publication_date).
  --page <n>              1-indexed page (20 results/page). Default 1.
  --pages <n>             Pages to sweep when -q is used (default 3, max 10).
  --limit, -n <n>         Cap results emitted.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search --category "Software Engineering" -l "Remote" --format table
  bun run src/cli.ts search -q "python" --category "Software Engineering" -l "Remote" --pages 5 --format table
  bun run src/cli.ts search --category "Data Science" --level "Senior Level" -l "Remote" -n 10
  bun run src/cli.ts detail 20693577 --format plain
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
      process.stderr.write(
        JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
      )
      return null
    }
    return val
  }

  if (cmd === "search") {
    for (const name of ["jobage", "page", "pages", "limit"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      category: typeof flags.category === "string" ? flags.category : undefined,
      level: typeof flags.level === "string" ? flags.level : undefined,
      company: typeof flags.company === "string" ? flags.company : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      pages: flags.pages ? Math.max(1, parseInt(flags.pages as string, 10)) : 3,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = { id, format: fmt === "plain" ? "plain" : "json" }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
