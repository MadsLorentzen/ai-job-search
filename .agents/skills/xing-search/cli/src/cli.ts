#!/usr/bin/env bun
// Self-contained CLI for finding jobs on Xing (xing.com), the DACH-market
// professional network. No official search API is reachable without violating
// robots.txt (see helpers.ts for the full data-source note), so this works by
// caching Xing's own job-URL sitemap and keyword-matching + verifying against
// real detail pages. Zero runtime dependencies beyond `bun` and `node:zlib`/`node:fs`.
//
// Personal use only. Keep volume low and do not use this commercially or for bulk
// data collection. Run it on your own responsibility.

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

const HELP = `xing-cli — search jobs on Xing (xing.com, DACH market)

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, role). REQUIRED.
  --location, -l <text>   City/region to additionally require in the match, e.g. "Frankfurt", "Köln".
  --jobage <days>         Posted within N days. Default: all (subject to --limit/probe budget).
  --page <n>              1-indexed page over the matched candidate list. Default 1.
  --limit, -n <n>         Max results to return. Default 20.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "Embedded Software Engineer" --format table
  bun run src/cli.ts search -q "Projektleiter" -l "Frankfurt" --jobage 14 --format table
  bun run src/cli.ts detail koeln-ot-cyber-security-senior-consultant-122981029 --format plain

Personal use only — uses Xing's public sitemap and job detail pages; keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
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

  const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
    const val = typeof raw === "string" ? Number(raw.trim()) : NaN
    if (!Number.isInteger(val) || val < 0) {
      process.stderr.write(
        JSON.stringify({ error: `--${name} must be a whole number of at least 0, got "${raw}"`, code: "BAD_ARG" }) + "\n",
      )
      return null
    }
    return val
  }

  if (cmd === "search") {
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      process.stderr.write(
        JSON.stringify({ error: "the --query/-q flag is required", code: "NO_QUERY" }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"

    for (const [name, val] of [
      ["jobage", flags.jobage],
      ["page", flags.page],
      ["limit", flags.limit],
    ] as const) {
      if (val !== undefined && parseIntFlag(name, val) === null) return 1
    }

    const opts: SearchOpts = {
      query,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? Math.max(0, parseInt(flags.limit as string, 10)) : 20,
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
