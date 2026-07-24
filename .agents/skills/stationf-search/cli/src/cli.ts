#!/usr/bin/env bun
// Self-contained CLI for the STATION F job board (jobs.stationf.co). No CLI
// framework and zero runtime dependencies, so it runs anywhere `bun` is present
// with nothing installed beyond the repo clone.
//
// The board is public and its robots.txt allows all paths; the Algolia search
// credentials are the ones the board page publishes for its own JavaScript.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CONTRACT_ALIASES, REMOTE_ALIASES, resolveAlias } from "./helpers.js"

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
    const name = a.replace(/^-+/, "")
    const key = ALIAS[name] ?? name
    const next = argv[i + 1]
    let value: string | boolean = true
    if (next !== undefined && !next.startsWith("-")) {
      value = next
      i++
    }
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

function stringFlag(raw: FlagValue): string | undefined {
  return typeof raw === "string" ? raw : undefined
}

function commaList(raw: FlagValue): string[] {
  if (typeof raw !== "string") return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

const HELP = `stationf-cli — search the STATION F job board (jobs.stationf.co)

USAGE
  bun run src/cli.ts search [-q "<mots-clés>"] [filtres] [--format json|table|plain]
  bun run src/cli.ts detail <org-slug/job-slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Full-text keywords (title, company, description).
  --location, -l <cities> City/cities, comma = OR. e.g. -l Paris,Marseille
  --region <states>       Region(s) as the board spells them, e.g. --region Ile-de-France
  --country <codes>       ISO-3166 alpha-2, e.g. --country FR,ES
  --contract <types>      cdi | cdd | stage | alternance | freelance | autres
  --remote <modes>        full | partial | punctual | no   (télétravail)
  --department <names>    Tech, Business, Sales, Marketing, Opérations, ...
  --company <slugs>       Organization slug(s), e.g. --company joko-1
  --language <codes>      Posting language: fr | en | es | de | it
  --jobage <days>         Keep postings published within N days (client-side).
  --sort <mode>           relevance (default) | date
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Results to return. Default 20.
  --format <fmt>          json (default) | table | plain
  --facet <attr=value>    Any other index attribute (repeatable),
                          e.g. --facet education_level=BAC_5

DETAIL
  <id>                    "<org-slug>/<job-slug>" from a search result's id, or a
                          full https://jobs.stationf.co/companies/.../jobs/... URL

EXAMPLES
  bun run src/cli.ts search -q "data engineer" -l Paris --contract cdi --format table
  bun run src/cli.ts search --department Tech --remote partial --jobage 14 --format table
  bun run src/cli.ts search -q "product manager" --contract stage,alternance --format table
  bun run src/cli.ts search --company joko-1 --sort date --format table
  bun run src/cli.ts detail allphins/data-engineer-h-f_paris --format plain

Data: the board's own public Algolia index (read-only, no account). ~650 live
postings from STATION F resident startups.
`

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = parseInt(raw as string, 10)
  if (isNaN(val)) {
    process.stderr.write(
      JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
    )
    return null
  }
  return val
}

/** Map a comma-list through an alias table, reporting the first bad value. */
function resolveList(
  name: string,
  raw: FlagValue,
  table: Record<string, string>,
): string[] | null {
  const out: string[] = []
  for (const value of commaList(raw)) {
    const resolved = resolveAlias(table, value)
    if (!resolved) {
      const accepted = [...new Set(Object.keys(table))].join(", ")
      process.stderr.write(
        JSON.stringify({
          error: `--${name} value "${value}" is not recognized. Accepted: ${accepted}`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return null
    }
    out.push(resolved)
  }
  return out
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
    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const contracts = resolveList("contract", flags.contract, CONTRACT_ALIASES)
    if (contracts === null) return 1
    const remote = resolveList("remote", flags.remote, REMOTE_ALIASES)
    if (remote === null) return 1

    const sortRaw = stringFlag(flags.sort) ?? "relevance"
    if (!["relevance", "date"].includes(sortRaw)) {
      process.stderr.write(
        JSON.stringify({
          error: `--sort must be "relevance" or "date", got "${sortRaw}"`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }

    const facets: Record<string, string[]> = {}
    for (const kv of Array.isArray(flags.facet) ? flags.facet : []) {
      const eq = kv.indexOf("=")
      if (eq <= 0) {
        process.stderr.write(
          JSON.stringify({ error: `invalid --facet "${kv}", want attr=value`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
      const key = kv.slice(0, eq)
      facets[key] = (facets[key] ?? []).concat(commaList(kv.slice(eq + 1)))
    }

    const fmt = stringFlag(flags.format) ?? "json"
    const opts: SearchOpts = {
      query: stringFlag(flags.query),
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? Math.max(1, parseInt(flags.limit as string, 10)) : 20,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
      sort: sortRaw as SearchOpts["sort"],
      cities: commaList(flags.location),
      regions: commaList(flags.region),
      countries: commaList(flags.country).map((c) => c.toUpperCase()),
      contracts,
      remote,
      departments: commaList(flags.department),
      companies: commaList(flags.company),
      languages: commaList(flags.language).map((l) => l.toLowerCase()),
      facets,
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires an <org-slug/job-slug|url>", code: "NO_ID" }) + "\n",
      )
      return 1
    }
    const fmt = stringFlag(flags.format) ?? "json"
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
