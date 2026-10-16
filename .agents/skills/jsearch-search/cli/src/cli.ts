#!/usr/bin/env bun
// Self-contained CLI for the JSearch API (Google for Jobs data via RapidAPI).
// Zero runtime dependencies. Every request is billed against the user's
// RapidAPI plan; the key comes only from the JSEARCH_API_TOKEN env variable.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { ApiError, writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
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

const HELP = `jsearch-cli — search Google for Jobs (Indeed, LinkedIn, Glassdoor, employer sites) via JSearch

Needs JSEARCH_API_TOKEN (your RapidAPI key). Every call is billed against your RapidAPI plan.

USAGE
  bun run src/cli.ts search -q "<keywords>" [flags]
  bun run src/cli.ts detail <id> [--country ie] [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill). REQUIRED.
  --location, -l <text>   Place, appended to the query as "in <place>". e.g. "Dublin, Ireland".
  --country <code>        ISO country code that scopes results, e.g. ie.
  --jobage <days>         Posted within N days (bucketed to today/3days/week/month, then trimmed exactly).
  --remote                Remote jobs only.
  --exclude-publishers <list>  Comma-separated sources to leave out, e.g. "LinkedIn" (saves quota
                          when another portal already covers that source).
  --cursor <token>        Next page: pass meta.nextCursor from the previous search (one billed request each).
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "data engineer" -l "Dublin, Ireland" --country ie --jobage 7 --format table
  bun run src/cli.ts search -q "QA engineer" -l "Dublin, Ireland" --country ie --jobage 7
  bun run src/cli.ts detail "<id from search>" --country ie --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "country", "jobage", "remote", "exclude-publishers", "cursor", "limit", "format", "help", "h"]),
  detail: new Set(["country", "format", "help", "h"]),
}

function bad(error: string, code = "BAD_ARG"): number {
  writeError(error, code)
  return 1
}

function wholeNumber(name: string, raw: string | boolean | string[]): number | null {
  const v = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(v) || v < 1) {
    writeError(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
    return null
  }
  return v
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const known = KNOWN_FLAGS[cmd]
  if (!known) return bad(`Unknown command "${cmd}"`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key !== "_" && !known.has(key)) {
      return bad(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help`,
        "UNKNOWN_FLAG",
      )
    }
  }
  const fmt = typeof flags.format === "string" ? flags.format : "json"
  const country = typeof flags.country === "string" ? flags.country : undefined
  if (country !== undefined && !/^[a-zA-Z]{2}$/.test(country)) return bad(`--country must be a 2-letter ISO code, got "${country}"`)

  if (cmd === "search") {
    if (typeof flags.query !== "string" || !flags.query.trim()) {
      return bad('the --query/-q flag is required (e.g. -q "data engineer")', "NO_QUERY")
    }
    const nums: Record<string, number | undefined> = {}
    for (const name of ["jobage", "limit"]) {
      if (flags[name] === undefined) continue
      const v = wholeNumber(name, flags[name])
      if (v === null) return 1
      nums[name] = v
    }
    if (!["json", "table", "plain"].includes(fmt)) return bad(`--format must be json, table or plain, got "${fmt}"`)
    const opts: SearchOpts = {
      query: flags.query.trim(),
      location: typeof flags.location === "string" ? flags.location : undefined,
      country,
      jobage: nums.jobage,
      remote: flags.remote === true,
      excludePublishers: typeof flags["exclude-publishers"] === "string" ? flags["exclude-publishers"] : undefined,
      cursor: typeof flags.cursor === "string" ? flags.cursor : undefined,
      limit: nums.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  const id = (flags._ as string[])[1]
  if (!id) return bad("detail requires an <id> from search output", "NO_ID")
  if (!["json", "plain"].includes(fmt)) return bad(`--format must be json or plain, got "${fmt}"`)
  const opts: DetailOpts = { id, country, format: fmt as DetailOpts["format"] }
  return runDetail(opts)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    if (e instanceof ApiError) writeError(e.message, e.code)
    else writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
