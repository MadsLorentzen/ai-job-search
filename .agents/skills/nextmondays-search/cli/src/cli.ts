#!/usr/bin/env bun
// Self-contained CLI for searching freelance tech missions on Next Mondays
// (https://nextmondays.com), a French freelance-tech job board. No authentication,
// no API key, zero runtime dependencies — it runs anywhere `bun` is available.
//
// robots.txt on nextmondays.com disallows `/Search`. This CLI never requests it:
// it reads the allowed listing surfaces (`/jobs/regions/*`, `/jobs/groups/*`,
// `/jobs/tags/*`) and filters by keyword client-side. See url-reference.md.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", g: "group", t: "tag" }
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

const KNOWN_FLAGS = new Set([
  "query",
  "location",
  "group",
  "tag",
  "jobage",
  "tjm-min",
  "include-filled",
  "enrich",
  "page",
  "limit",
  "format",
  "help",
  "h",
])

const HELP = `nextmondays-cli — freelance tech missions in France (nextmondays.com)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords, matched client-side against title, client blurb,
                          tags and domain. Space-separated terms are ANDed.
                          Accent-insensitive ("developpeur" matches "développeur").
  --location, -l <text>   City or region, e.g. "Paris", "Lyon", "Île-de-France".
                          Only on detail pages, so this triggers enrichment (slower).
  --group, -g <name>      Job domain: electronique | "infra & ops" | "logiciel embarqué"
                          | management | "test & qa" | "web & edition".
  --tag, -t <name>        Exact site tag, e.g. typescript, react, python, devops.
  --jobage <days>         Posted within N days. Triggers enrichment (slower).
  --tjm-min <n>           Minimum published daily rate (EUR/day).
  --include-filled        Include missions marked "offre pourvue" (excluded by default).
  --enrich                Fetch each match's detail page to fill location and date.
  --page <n>              1-indexed page (20 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "typescript" --format table
  bun run src/cli.ts search -q "node backend" --tjm-min 550 --format table
  bun run src/cli.ts search -t typescript -l Paris --format table
  bun run src/cli.ts search -g "web & edition" --jobage 90 --format table
  bun run src/cli.ts search -q "python" --enrich --limit 5
  bun run src/cli.ts detail 03P711928 --format plain

NOTE
  Next Mondays is a placement intermediary: the end client is never named, so
  "company" is always null and the anonymised blurb lands in "clientProfile".
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
    for (const key of Object.keys(flags)) {
      if (key !== "_" && !KNOWN_FLAGS.has(key)) {
        process.stderr.write(
          JSON.stringify({ error: `Unknown flag "--${key}"`, code: "BAD_ARG" }) + "\n",
        )
        return 1
      }
    }

    const fmt = (flags.format as string) || "json"

    const parseNumFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = typeof raw === "string" ? Number(raw) : NaN
      if (!isFinite(val)) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
        )
        return null
      }
      return val
    }

    let jobage: number | undefined
    if (flags.jobage !== undefined) {
      const v = parseNumFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }
    let tjmMin: number | undefined
    if (flags["tjm-min"] !== undefined) {
      const v = parseNumFlag("tjm-min", flags["tjm-min"])
      if (v === null) return 1
      tjmMin = v
    }
    let page = 1
    if (flags.page !== undefined) {
      const v = parseNumFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, Math.floor(v))
    }
    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseNumFlag("limit", flags.limit)
      if (v === null) return 1
      limit = Math.floor(v)
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      group: typeof flags.group === "string" ? flags.group : undefined,
      tag: typeof flags.tag === "string" ? flags.tag : undefined,
      jobage,
      tjmMin,
      includeFilled: flags["include-filled"] === true,
      enrich: flags.enrich === true,
      page,
      limit,
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
