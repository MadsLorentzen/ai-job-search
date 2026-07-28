#!/usr/bin/env bun
// Self-contained CLI for searching job postings via the Firecrawl v2 REST API.
// No external CLI framework and zero runtime dependencies (no SDK — plain
// `fetch`), so it runs anywhere `bun` is available with nothing installed beyond
// the repo clone.
//
// Credentialed hosted source: the cloud API needs FIRECRAWL_API_KEY. A self-hosted
// FIRECRAWL_API_URL may be keyless. Without either, every command exits 1 with a
// NO_API_KEY error, so /scrape degrades this source instead of breaking the run.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { NO_API_KEY_MESSAGE, baseUrl, normalizeDomain, requiresApiKey } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

// Short-flag aliases.
const ALIAS: Record<string, string> = { q: "query", n: "limit", l: "location" }

// Flags that may repeat; each occurrence is collected instead of last-wins.
const REPEATABLE = new Set(["site", "exclude-site"])

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
    if (REPEATABLE.has(key)) {
      const acc = Array.isArray(flags[key]) ? (flags[key] as string[]) : []
      if (typeof value === "string") acc.push(value)
      flags[key] = acc
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

/** Split comma-separated and repeated values into one trimmed hostname list. */
function domainList(raw: FlagValue): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return parts
    .flatMap((p) => p.split(","))
    .map(normalizeDomain)
    .filter((d): d is string => d !== null)
}

const HELP = `firecrawl-cli — search job postings anywhere on the web via Firecrawl

USAGE
  bun run src/cli.ts search -q "<keywords>" [--site <domains>] [--format json|table|plain]
  bun run src/cli.ts detail <url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (required). Supports search operators, e.g.
                          "data engineer" -internship
  --site <domains>        Restrict to these job boards (comma-separated, repeatable),
                          e.g. --site jobindex.dk,linkedin.com
  --exclude-site <doms>   Drop these domains instead. Mutually exclusive with --site.
  --country <code>        ISO-3166 alpha-2 search locale, e.g. --country DK. Default US.
  --location, -l <place>  Geo-target the results, e.g. --location "Berlin,Germany"
  --jobage <days>         Search-freshness hint (bucketed: day/week/month/year).
                          NOT a filter on the posting date - see SKILL.md.
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Results per page. Default 10 (page x limit must be <= 100).
  --no-enrich             Skip per-result extraction: much cheaper and faster, but
                          company/location/date come back null.
  --format <fmt>          json (default) | table | plain.

DETAIL
  <url>                   A posting URL (a search result's id/url is exactly this).

EXAMPLES
  bun run src/cli.ts search -q "data engineer" --country DK --jobage 14 --format table
  bun run src/cli.ts search -q "geophysicist" --site linkedin.com,jobindex.dk --limit 5 --format table
  bun run src/cli.ts search -q "\\"machine learning engineer\\" remote" --no-enrich --limit 20
  bun run src/cli.ts detail https://job-boards.greenhouse.io/acme/jobs/123 --format plain

Endpoint: ${baseUrl()} — needs FIRECRAWL_API_KEY (https://firecrawl.dev); override
with FIRECRAWL_API_URL for a self-hosted instance, which needs no key by default.

COST — this is a metered API. Measured: a plain search costs 2 * ceil(limit / 10);
enrichment adds ~5 per successfully enriched result, so --limit 20 costs ~104 when
all results are enriched. Use --no-enrich for wide sweeps and keep --limit small.
Every run reports meta.credits_used.
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

  // Fail fast and identifiably when the hosted API is targeted without a key. A
  // self-hosted instance (FIRECRAWL_API_URL) is exempt: it runs unauthenticated
  // by default, so demanding a key there would reject a working local backend.
  if ((cmd === "search" || cmd === "detail") && requiresApiKey()) {
    process.stderr.write(JSON.stringify({ error: NO_API_KEY_MESSAGE, code: "NO_API_KEY" }) + "\n")
    return 1
  }

  if (cmd === "search") {
    const query = stringFlag(flags.query)
    if (!query) {
      process.stderr.write(JSON.stringify({ error: "search requires --query/-q", code: "NO_QUERY" }) + "\n")
      return 1
    }

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const sites = domainList(flags.site)
    const excludeSites = domainList(flags["exclude-site"])
    if (sites.length && excludeSites.length) {
      process.stderr.write(
        JSON.stringify({ error: "--site and --exclude-site cannot be combined", code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      query,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? Math.max(1, parseInt(flags.limit as string, 10)) : 10,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
      sites,
      excludeSites,
      country: stringFlag(flags.country)?.toUpperCase(),
      location: stringFlag(flags.location),
      // Presence of the flag disables enrichment, however it was written - a
      // stray following word must not silently turn it back on.
      enrich: flags["no-enrich"] === undefined,
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
