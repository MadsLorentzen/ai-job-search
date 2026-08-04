#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Jobsdb Hong Kong's public pages.
// No external CLI framework, so it runs anywhere `bun` is available.
//
// Personal use only. Jobsdb's robots.txt disallows these paths for automated
// crawlers; keep volume low and do not use this commercially or for bulk data
// collection. Run it on your own responsibility.

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

const HELP = `jobsdb-hk-cli — search jobs on Jobsdb Hong Kong

USAGE
  bun run src/cli.ts search -q "<keywords>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>    Job title, skill, or role. REQUIRED.
  --location, -l <text>  Optional location (e.g. "Hong Kong", "Kowloon Bay, Kwun Tong District").
  --jobage <days>      Max posting age: maps to 1, 3, 7, 14, or 31 days.
  --page <n>           1-indexed page number. Default 1.
  --limit, -n <n>      Cap results emitted (client-side).
  --format <fmt>      json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "AI engineer" --limit 5 --format table
  bun run src/cli.ts search -q "software engineer" -l "Hong Kong" --jobage 7 --format table
  bun run src/cli.ts detail 93714207 --format plain

Personal use only — Jobsdb robots.txt disallows these paths; keep volume low.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const allowedSearch = new Set(["query", "q", "location", "l", "jobage", "page", "limit", "n", "format", "help", "h"])
  const allowedDetail = new Set(["format", "help", "h"])
  const checkFlags = (allowed: Set<string>): boolean => {
    for (const key of Object.keys(flags)) {
      if (key === "_") continue
      if (!allowed.has(key)) {
        process.stderr.write(JSON.stringify({ error: `Unknown flag "${key}"`, code: "BAD_FLAG" }) + "\n")
        return false
      }
    }
    return true
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
    if (!checkFlags(allowedSearch)) return 1
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      process.stderr.write(
        JSON.stringify({
          error: 'the --query/-q flag is required (e.g. -q "AI engineer")',
          code: "NO_QUERY",
        }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"

    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      flags.jobage = String(v)
    }
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      flags.page = String(v)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }

    const opts: SearchOpts = {
      query,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    if (!checkFlags(allowedDetail)) return 1
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
