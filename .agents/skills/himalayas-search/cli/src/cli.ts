#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Himalayas' public JSON API.
// No external CLI framework, so it runs anywhere `bun` is available with zero
// install beyond the repo clone. All listings are remote by definition.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", p: "pages" }
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

const HELP = `himalayas-cli — search jobs on Himalayas (remote-only listings worldwide)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--pages <n>] [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (title, company, categories, description).
  --location, -l <text>   Optional country/region substring filter (e.g. "Canada",
                          "Europe"). Postings with no location restriction always match.
  --pages, -p <n>         Pages of 20 postings each to scan (newest first). Default 5
                          (100 postings). Raise for a wider client-side search.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "data engineer" --format table
  bun run src/cli.ts search -q "designer" -l "Canada" --pages 10 --format table
  bun run src/cli.ts detail bizcover/customer-care-consultants --format plain

Notes: Himalayas' public API has no server-side keyword search and caps each page at
20 postings, so this CLI pages through --pages pages and filters client-side.
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

    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }
    let pages = 5
    if (flags.pages !== undefined) {
      const v = parseIntFlag("pages", flags.pages)
      if (v === null) return 1
      pages = Math.max(1, v)
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      pages,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
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
    let pages = 15
    if (flags.pages !== undefined) {
      const v = parseIntFlag("pages", flags.pages)
      if (v === null) return 1
      pages = Math.max(1, v)
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      pages,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
    }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main().then((code) => process.exit(code))
