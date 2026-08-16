#!/usr/bin/env bun
// Self-contained CLI for registry-driven lookups of specific companies' own
// career pages — for corporates that don't syndicate all positions to job
// boards (common among Swiss corporates, banks, pharma, orgs in Geneva/
// Lausanne). No external CLI framework, so it runs anywhere `bun` is
// available with zero install beyond the repo clone.
//
// Personal use only. This reads companies' own public career APIs/pages;
// keep volume low and don't use it commercially or for bulk data collection.
// Run it on your own responsibility.

import { runList, type ListOpts } from "./commands/list.js"
import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", c: "company" }
  const resolve = (raw: string): string => alias[raw] ?? raw
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const bare = a.replace(/^-+/, "")
      // `--key=value` must be understood, not swallowed. Parsing it as a flag
      // named "key=value" left --company= silently unset, so a typo queried the
      // whole registry instead of one employer — the opposite of keeping volume
      // low. Every other portal CLI in this repo accepts the equals form too.
      const eq = bare.indexOf("=")
      if (eq > 0) {
        flags[resolve(bare.slice(0, eq))] = bare.slice(eq + 1)
        continue
      }
      const key = resolve(bare)
      const next = argv[i + 1]
      // A negative number is a value, not the next flag: `--limit -5` must reach
      // the validator and be rejected rather than parse as `limit: true`.
      if (next === undefined || (next.startsWith("-") && !/^-\d/.test(next))) {
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

const HELP = `company-pages-cli — look up openings on companies' own career pages

USAGE
  bun run src/cli.ts list [--format json|table|plain]
  bun run src/cli.ts search [--company <name>] [--query <kw>] [--location <substr>] [--limit <n>] [--format json|table|plain]
  bun run src/cli.ts detail --company <name> --id <job id> [--format json|plain]

REGISTRY
  Reads ./company_pages.json at the repo root (personal, gitignored). Falls back
  to the committed .agents/skills/company-pages-search/company_pages.example.json
  with a stderr warning if the personal file doesn't exist yet.

SEARCH FLAGS
  --company, -c <name>    Restrict to one registry entry (exact name match).
  --query, -q <text>      Keyword filter on job title (client-side substring).
  --location <text>       Location filter (client-side substring).
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

DETAIL FLAGS
  --company <name>        REQUIRED. Registry entry name (must not be ats=generic).
  --id <job id>            REQUIRED. The ATS's own job id (from a search result).
  --format <fmt>          json (default) | plain.

EXAMPLES
  bun run src/cli.ts list --format table
  bun run src/cli.ts search --company Stripe --format table
  bun run src/cli.ts search --query "product" --location Geneva --format table
  bun run src/cli.ts detail --company Stripe --id 7954688 --format plain

Personal use only — reads companies' own public career APIs/pages; keep volume low.
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
    const text = String(raw)
    // A bare parseInt accepted "5x" and "-5". The former is a typo worth
    // reporting; the latter used to slip past the `>= 0` guard downstream and
    // silently return the whole result set instead of the cap that was asked for.
    if (!/^-?\d+$/.test(text)) {
      process.stderr.write(
        JSON.stringify({ error: `--${name} must be a whole number, got "${text}"`, code: "BAD_ARG" }) + "\n",
      )
      return null
    }
    const val = parseInt(text, 10)
    if (val < 0) {
      process.stderr.write(
        JSON.stringify({ error: `--${name} must not be negative, got ${val}`, code: "BAD_ARG" }) + "\n",
      )
      return null
    }
    return val
  }

  if (cmd === "list") {
    const fmt = (flags.format as string) || "json"
    const opts: ListOpts = {
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as ListOpts["format"],
    }
    return runList(opts)
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"
    // An empty or valueless --company must not fall through to "every entry".
    // Silently widening a one-employer query to the whole watchlist is the same
    // failure as the --company=X parsing bug, reached a different way.
    for (const name of ["company", "query", "location"]) {
      const v = flags[name]
      if (v !== undefined && (v === true || String(v).trim() === "")) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} was given without a value`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }
    const opts: SearchOpts = {
      company: typeof flags.company === "string" ? flags.company : undefined,
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const company = typeof flags.company === "string" ? flags.company : undefined
    const id = typeof flags.id === "string" ? flags.id : undefined
    if (!company || !id) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires --company <name> and --id <job id>", code: "NO_ARGS" }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      company,
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
