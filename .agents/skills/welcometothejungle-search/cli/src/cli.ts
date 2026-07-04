#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Welcome to the Jungle's public Algolia
// index (search) and its public read-only jobs API (detail). No external CLI
// framework and zero runtime dependencies, so it runs anywhere `bun` is available.
//
// Personal use only. This reads WTTJ's public data; keep volume low and do not use
// it commercially or for bulk data collection. Run it on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = {
    q: "query",
    l: "location",
    c: "country",
    n: "limit",
  }
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

const HELP = `wttj-cli — search jobs on Welcome to the Jungle (any country/city, plus remote)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <reference|org/slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, or role).
  --location, -l <city>   Filter by office city (exact WTTJ facet, e.g. "Paris",
                          "London", "Los Angeles").
  --country, -c <ISO>     Filter by office country code (e.g. US, FR, GB, DE).
  --remote <mode>         full | hybrid | occasional | none  (WTTJ remote policy).
  --contract <type>       full_time | part_time | internship | apprenticeship |
                          freelance | temporary | vie | other.
  --since <days>          Only jobs published within N days (client-side filter).
  --page <n>              1-indexed page (20 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "devops engineer" -c US --format table
  bun run src/cli.ts search -q "data engineer" -l "Paris" --remote hybrid --format table
  bun run src/cli.ts search -q "platform engineer" --remote full --contract full_time --format table
  bun run src/cli.ts detail ND_W75QPAW --format plain

NOTE
  Welcome to the Jungle is heavily France/Europe-weighted; US and fully-remote
  listings are comparatively few. Pass the reference from search results to detail.
  Personal use only — uses WTTJ's public data; keep volume low.
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
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      city: typeof flags.location === "string" ? flags.location : undefined,
      country: typeof flags.country === "string" ? flags.country : undefined,
      remote: typeof flags.remote === "string" ? flags.remote : undefined,
      contract: typeof flags.contract === "string" ? flags.contract : undefined,
      since: flags.since ? parseInt(flags.since as string, 10) : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires a <reference|org/slug|url>", code: "NO_ID" }) + "\n",
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

main().then((code) => process.exit(code))
