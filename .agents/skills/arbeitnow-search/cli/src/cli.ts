#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Arbeitnow's public job-board API (Germany-focused,
// includes English-speaking / remote-friendly listings). No external CLI framework, so it
// runs anywhere `bun` is available with zero install beyond the repo clone.
//
// See helpers.ts: the API has no server-side keyword/location search, only pagination —
// this CLI fetches one page and filters client-side.

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
    const a = argv[i]!
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

const HELP = `arbeitnow-cli — search jobs on Arbeitnow (Germany-focused, incl. English-speaking / remote)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords, matched against title, company, and tags. Recommended.
  --location, -l <text>   Substring match against the location field, e.g. "Berlin".
  --jobage <days>         Only jobs posted within N days (uses the API's created_at field).
  --page <n>              1-indexed server page to fetch (~176 jobs/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side, applied after filtering).
  --format <fmt>          json (default) | table | plain.

  Note: Arbeitnow's API has NO server-side search — --query/--location/--jobage all filter
  the ONE page fetched by --page, client-side. To search more broadly, call search again
  with a higher --page (jobs are in reverse-chronological order, so higher pages are older).

DETAIL
  <url>   The full "url" field from a search result. Bare job slugs cannot be turned into a
          URL on their own (the URL also needs the company slug) — always pass the URL.

EXAMPLES
  bun run src/cli.ts search -q "Product Owner" --format table
  bun run src/cli.ts search -q "Product Manager" -l Berlin --jobage 14 --format table
  bun run src/cli.ts search --page 2 --format json
  bun run src/cli.ts detail "https://www.arbeitnow.com/jobs/companies/awin/machine-learning-engineer-berlin-berlin-munchen-bavaria-180645" --format plain
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
        process.stderr.write(JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n")
        return null
      }
      return val
    }

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name]!)
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobageDays: flags.jobage ? parseInt(flags.jobage as string, 10) : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <url>", code: "NO_ID" }) + "\n")
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
