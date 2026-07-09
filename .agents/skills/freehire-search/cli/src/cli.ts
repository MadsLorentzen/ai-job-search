#!/usr/bin/env bun
// Self-contained CLI for searching the freehire.dev aggregator's public JSON API.
// No external CLI framework and zero runtime dependencies, so it runs anywhere
// `bun` is available with nothing installed beyond the repo clone.
//
// Hosted-service dependency: reads are public (no API key), but they hit
// freehire.dev — a personal project maintained best-effort (no formal SLA). Point
// FREEHIRE_API_URL at a self-hosted freehire backend to swap the source.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { baseUrl } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

// Short-flag aliases.
const ALIAS: Record<string, string> = { q: "query", n: "limit" }

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      ;(flags._ as string[]).push(a)
      continue
    }
    const name = a.replace(/^-+/, "")
    const key = ALIAS[name] ?? name
    const next = argv[i + 1]
    // A flag with no following value (or another flag next) is a boolean.
    let value: string | boolean = true
    if (next !== undefined && !next.startsWith("-")) {
      value = next
      i++
    }
    // --facet repeats; collect into an array. Everything else is last-wins.
    if (key === "facet") {
      const acc = Array.isArray(flags.facet) ? flags.facet : []
      if (typeof value === "string") acc.push(value)
      flags.facet = acc
    } else {
      flags[key] = value
    }
  }
  return flags
}

type FlagValue = string | boolean | string[] | undefined

/**
 * A flag's string value. A bare flag (set without a value, i.e. `true`) yields
 * `whenBare` — e.g. `--remote` alone means work_mode "remote".
 */
function stringFlag(raw: FlagValue, whenBare?: string): string | undefined {
  if (typeof raw === "string") return raw
  if (raw === true) return whenBare
  return undefined
}

/** Split a comma-separated facet value ("eu,us") into a trimmed value list. */
function commaList(raw: FlagValue): string[] {
  if (typeof raw !== "string") return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

const HELP = `freehire-cli — search the freehire.dev job aggregator (many markets, tech-focused)

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [facet flags] [--format json|table|plain]
  bun run src/cli.ts detail <slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (title, skill, role). Full-text; optional.
  --jobage <days>         Posted within N days (maps to posted_within_days).
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Results per page (API limit). Default 25.
  --format <fmt>          json (default) | table | plain.

FACET FILTERS (values from freehire.dev's controlled vocabularies; comma = OR)
  --region <codes>        Macro-region: global, eu, us, apac, latam, cis, ...  e.g. --region eu,us
  --country <codes>       ISO-3166 alpha-2, e.g. --country DE,GB
  --city <names>          City name(s), e.g. --city Berlin
  --seniority <levels>    junior, middle, senior, staff, principal, lead, ...
  --category <cats>       backend, frontend, fullstack, devops, ml_ai, qa, ...
  --skill <names>         Canonical skill(s), e.g. --skill go,kubernetes
  --company <slug>        Company slug (from a result's company_slug).
  --remote <mode>         remote | hybrid | onsite (work_mode facet).
  --facet <key=value>     Any other facet param (repeatable), e.g. --facet salary_min=100000

DETAIL
  <slug|url>              A freehire public slug (from a search result's id/slug)
                          or a full https://freehire.dev/jobs/<slug> URL.

EXAMPLES
  bun run src/cli.ts search -q "backend engineer" --seniority senior --limit 10 --format table
  bun run src/cli.ts search -q "react" --remote remote --region eu --format table
  bun run src/cli.ts search --category devops --country DE --jobage 14 --format table
  bun run src/cli.ts detail golang-zensar-2bxu6dxm --format plain

Reads are public (no API key). Source: ${baseUrl()} — a personal project,
best-effort, no SLA. Override with FREEHIRE_API_URL to use a self-hosted backend.
`

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = parseInt(raw as string, 10)
  if (isNaN(val)) {
    process.stderr.write(JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n")
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

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    // Generic --facet key=value list -> param -> values.
    const facets: Record<string, string[]> = {}
    const rawFacets = Array.isArray(flags.facet) ? flags.facet : []
    for (const kv of rawFacets) {
      const eq = kv.indexOf("=")
      if (eq <= 0) {
        process.stderr.write(JSON.stringify({ error: `invalid --facet "${kv}", want key=value`, code: "BAD_ARG" }) + "\n")
        return 1
      }
      const key = kv.slice(0, eq)
      const vals = commaList(kv.slice(eq + 1))
      facets[key] = (facets[key] ?? []).concat(vals)
    }

    const opts: SearchOpts = {
      query: stringFlag(flags.query),
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? Math.max(1, parseInt(flags.limit as string, 10)) : 25,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
      regions: commaList(flags.region),
      countries: commaList(flags.country),
      cities: commaList(flags.city),
      seniority: commaList(flags.seniority),
      category: commaList(flags.category),
      skills: commaList(flags.skill),
      company: stringFlag(flags.company),
      // --remote <mode> takes the given work_mode; a bare --remote means "remote".
      workMode: stringFlag(flags.remote, "remote"),
      facets,
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
    const opts: DetailOpts = { id, format: fmt === "plain" ? "plain" : "json" }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main().then((code) => process.exit(code))
