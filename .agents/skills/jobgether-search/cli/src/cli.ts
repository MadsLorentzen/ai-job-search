#!/usr/bin/env bun
// Self-contained CLI for searching jobgether.com's public job API — a global,
// English-language remote-jobs aggregator. No external CLI framework and zero
// runtime dependencies, so it runs anywhere `bun` is available with nothing
// installed beyond the repo clone.
//
// Search hits jobgether's own /api/v1/jobs API (documented at
// /astroapi/ai/jobs/docs, built explicitly for AI agents/assistants — no
// authentication, no rate-limit surprises documented). `detail` fetches the
// HTML offer page and reads its embedded JobPosting JSON-LD, since there is no
// JSON endpoint for a single posting.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", l: "location", n: "limit" }

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      ;(flags._ as string[]).push(a)
      continue
    }
    const key = ALIAS[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("-")) {
      flags[key] = true
    } else {
      flags[key] = next
      i++
    }
  }
  return flags
}

type FlagValue = string | boolean | string[] | undefined

function stringFlag(raw: FlagValue): string | undefined {
  return typeof raw === "string" ? raw : undefined
}

function commaList(raw: FlagValue): string[] {
  if (typeof raw !== "string") return []
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

const HELP = `jobgether-cli — search jobgether.com's global remote-jobs API

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>       Keywords: title, skill, company, contract type. Optional.
  --location, -l <slugs>   Country/continent/city slugs, comma-separated, e.g.
                           "spain", "europe", "worldwide". Unknown slugs are
                           rejected by the API itself (400).
  --job-function <slugs>   Job-function slugs, comma-separated, e.g. "product-manager".
  --industry <slugs>       Industry slugs or ids, comma-separated.
  --contract-type <types>  full-time | part-time | fixed-term | freelance | internships
                           (comma-separated for OR).
  --experience <levels>    entry-level-graduate | junior-1-2-years | mid-level-2-5-years |
                           senior-5-10-years | expert-10-years (comma-separated for OR).
  --remote <mode>          full-remote | remote-first | hybrid.
  --include-hybrid         Also include hybrid roles alongside remote ones.
  --salary-min <n>         Minimum annual salary, in --currency.
  --salary-max <n>         Maximum annual salary, in --currency.
  --currency <code>        ISO currency code for the salary flags, e.g. EUR.
  --sort <mode>            relevance (default) | date.
  --jobage <days>          Posted within N days — filtered client-side on the
                           fetched page only (the API has no such parameter);
                           combine with --sort date for freshest-first.
  --page <n>               1-indexed page. Capped at 10 by the API. Default 1.
  --limit, -n <n>          Results per page. Default 10, capped at 25 by the API.
  --format <fmt>           json (default) | table | plain.

DETAIL
  <id|url>                 A job id (from a search result's "id") or its full
                           https://jobgether.com/offer/<id>-<slug> URL.

EXAMPLES
  bun run src/cli.ts search -q "product manager" -l "spain,europe" --remote full-remote --format table
  bun run src/cli.ts search -q "engineer" --experience senior-5-10-years --sort date --format table
  bun run src/cli.ts search -q "designer" --contract-type freelance --salary-min 50000 --currency EUR
  bun run src/cli.ts detail 6aaf5383865119c687d03d66 --format plain

All errors are written to stderr as { "error": "...", "code": "..." }, exit code 1.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "job-function", "industry", "contract-type", "experience",
    "remote", "include-hybrid", "salary-min", "salary-max", "currency", "sort",
    "jobage", "page", "limit", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    process.stderr.write(
      JSON.stringify({ error: `--${name} must be a whole number of at least 1, got "${raw}"`, code: "BAD_ARG" }) + "\n",
    )
    return null
  }
  return val
}

function parseNumberFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (Number.isNaN(val)) {
    process.stderr.write(
      JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
    )
    return null
  }
  return val
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }
    let salaryMin: number | undefined
    let salaryMax: number | undefined
    if (flags["salary-min"] !== undefined) {
      const v = parseNumberFlag("salary-min", flags["salary-min"])
      if (v === null) return 1
      salaryMin = v
    }
    if (flags["salary-max"] !== undefined) {
      const v = parseNumberFlag("salary-max", flags["salary-max"])
      if (v === null) return 1
      salaryMax = v
    }

    const opts: SearchOpts = {
      query: stringFlag(flags.query),
      locations: commaList(flags.location),
      jobFunctions: commaList(flags["job-function"]),
      industries: commaList(flags.industry),
      contractType: commaList(flags["contract-type"]),
      experience: commaList(flags.experience),
      remoteType: stringFlag(flags.remote),
      includeHybrid: flags["include-hybrid"] === true,
      salaryMin,
      salaryMax,
      currency: stringFlag(flags.currency),
      sort: stringFlag(flags.sort),
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? Math.max(1, parseInt(flags.limit as string, 10)) : 10,
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
