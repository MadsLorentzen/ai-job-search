#!/usr/bin/env bun
// Self-contained CLI for Indeed job search through the Apify actor
// misceres/indeed-scraper. Zero runtime dependencies.
//
// Personal use only: the actor works around Indeed's bot protection, which
// Indeed's terms do not allow. Every run is billed to the user's Apify account
// and capped by --max-charge. The token comes only from APIFY_API_TOKEN.

import { runSearch, type SearchOpts } from "./commands/search.js"
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

const HELP = `indeed-cli — search Indeed through the Apify actor misceres/indeed-scraper

Needs APIFY_API_TOKEN. Every run is billed to your Apify account (about $3 per 1,000 jobs)
and capped by --max-charge. Personal use only (Indeed's terms).

USAGE
  bun run src/cli.ts search -q "<keywords>[;<keywords>...]" [flags]

SEARCH FLAGS
  --query, -q <text>      Keywords. REQUIRED. Separate several searches with ";" - they run
                          in ONE actor run (one start fee), e.g. "data engineer;qa engineer".
  --location, -l <text>   Indeed location, e.g. "Dublin" or "County Dublin".
  --country <code>        Indeed country site. Default: ie (ie.indeed.com).
  --jobage <days>         Indeed's own "posted within N days" filter (fromage), plus an exact
                          client-side trim.
  --limit, -n <n>         Max jobs per search (default 20). This is what you pay for.
  --max-charge <usd>      Hard spend cap for the run (default 1.00).
  --no-description        Drop job descriptions from the output (smaller output; same cost).
  --broad                 Plain keyword search. Default is an exact job-title phrase
                          (title:"..."), because Indeed's keyword search is loose and
                          every returned job is billed.
  --format <fmt>          json (default) | table | plain.

DETAIL
  Not offered: search results already carry the full description, so a separate billed
  run per job would only cost more. Use the result's description, or open its url.

EXAMPLES
  bun run src/cli.ts search -q "data engineer" -l "Dublin" --jobage 7 --format table
  bun run src/cli.ts search -q "data engineer;data quality analyst;qa engineer" -l "Dublin" --jobage 7 -n 15
`

const KNOWN = new Set(["query", "location", "country", "jobage", "limit", "max-charge", "no-description", "broad", "format", "help", "h"])

function bad(error: string, code = "BAD_ARG"): number {
  writeError(error, code)
  return 1
}

function positiveNumber(name: string, raw: string | boolean | string[], integer: boolean): number | null {
  const v = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isFinite(v) || v <= 0 || (integer && !Number.isInteger(v))) {
    writeError(`--${name} must be a ${integer ? "whole number of at least 1" : "positive number"}, got "${raw}"`, "BAD_ARG")
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
  if (cmd === "detail") {
    return bad("detail is not offered: search results already include the full description (a per-job run would be billed separately)", "DETAIL_UNSUPPORTED")
  }
  if (cmd !== "search") return bad(`Unknown command "${cmd}"`, "BAD_CMD")

  for (const key of Object.keys(flags)) {
    if (key !== "_" && !KNOWN.has(key)) {
      return bad(`unknown flag --${key} for 'search' - flags are never silently ignored; see --help`, "UNKNOWN_FLAG")
    }
  }
  if (typeof flags.query !== "string" || !flags.query.trim()) {
    return bad('the --query/-q flag is required (e.g. -q "data engineer")', "NO_QUERY")
  }
  const queries = flags.query.split(";").map((q) => q.trim()).filter(Boolean)
  if (queries.length > 20) return bad(`at most 20 searches per run, got ${queries.length}`)

  const country = typeof flags.country === "string" ? flags.country : "ie"
  if (!/^[a-zA-Z]{2}$/.test(country)) return bad(`--country must be a 2-letter code, got "${country}"`)

  let jobage: number | undefined
  if (flags.jobage !== undefined) {
    const v = positiveNumber("jobage", flags.jobage, true)
    if (v === null) return 1
    jobage = v
  }
  let limit = 20
  if (flags.limit !== undefined) {
    const v = positiveNumber("limit", flags.limit, true)
    if (v === null) return 1
    if (v > 100) return bad(`--limit is capped at 100 per search to keep runs cheap, got ${v}`)
    limit = v
  }
  let maxCharge = 1
  if (flags["max-charge"] !== undefined) {
    const v = positiveNumber("max-charge", flags["max-charge"], false)
    if (v === null) return 1
    maxCharge = v
  }
  const fmt = typeof flags.format === "string" ? flags.format : "json"
  if (!["json", "table", "plain"].includes(fmt)) return bad(`--format must be json, table or plain, got "${fmt}"`)

  const opts: SearchOpts = {
    queries,
    location: typeof flags.location === "string" ? flags.location : undefined,
    country,
    jobage,
    limit,
    maxCharge,
    withDescription: flags["no-description"] !== true,
    broad: flags.broad === true,
    format: fmt as SearchOpts["format"],
  }
  return runSearch(opts)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    if (e instanceof ApiError) writeError(e.message, e.code)
    else writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
