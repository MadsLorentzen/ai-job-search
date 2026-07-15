#!/usr/bin/env bun
// Self-contained CLI for the official Bundesagentur für Arbeit Jobsuche API
// (German government job portal). Public API with a static key — no registration,
// no scraping, zero runtime dependencies.

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

const HELP = `arbeitsagentur-cli — search jobs on the official German government job portal

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <refnr|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, profession).
  --location, -l <text>   City, postal code, or region (e.g. "Berlin", "70173").
  --radius <km>           Radius around --location in km (API default 25).
  --jobage <days>         Posted within N days (0–100).
  --worktime <type>       vz | tz | snw | ho | mj (combine: "vz;ho").
  --contract <type>       1 = temporary (befristet), 2 = permanent (unbefristet).
  --offertype <type>      1 = job (default), 4 = Ausbildung, 34 = Praktikum/Trainee.
  --employer <text>       Filter by employer name.
  --no-tempwork           Exclude temp-agency (Zeitarbeit) postings.
  --page <n>              1-indexed page. Default 1.
  --size <n>              Results per page (max 100). Default 20.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q python -l Berlin --jobage 7 --format table
  bun run src/cli.ts search -q "full stack entwickler" -l Stuttgart --radius 50 --no-tempwork --format table
  bun run src/cli.ts search -q mechatroniker -l Hamburg --offertype 4 --format table
  bun run src/cli.ts detail 12016-10004847581-S --format plain

Data source: official public API (https://jobsuche.api.bund.dev/), static key, no registration.
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

    let radius: number | undefined
    let jobage: number | undefined
    let page = 1
    let size = 20
    let limit: number | undefined

    if (flags.radius !== undefined) {
      const v = parseIntFlag("radius", flags.radius)
      if (v === null) return 1
      radius = v
    }
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = Math.min(Math.max(v, 0), 100)
    }
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, v)
    }
    if (flags.size !== undefined) {
      const v = parseIntFlag("size", flags.size)
      if (v === null) return 1
      size = Math.min(Math.max(1, v), 100)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }

    if (flags.contract !== undefined && !["1", "2"].includes(String(flags.contract))) {
      process.stderr.write(JSON.stringify({ error: `--contract must be 1 (temporary) or 2 (permanent), got "${flags.contract}"`, code: "BAD_ARG" }) + "\n")
      return 1
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      radius,
      jobage,
      worktime: typeof flags.worktime === "string" ? flags.worktime : undefined,
      contract: typeof flags.contract === "string" ? flags.contract : undefined,
      offertype: typeof flags.offertype === "string" ? flags.offertype : undefined,
      employer: typeof flags.employer === "string" ? flags.employer : undefined,
      noTempwork: flags["no-tempwork"] === true,
      page,
      size,
      limit,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <refnr|url>", code: "NO_ID" }) + "\n")
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
