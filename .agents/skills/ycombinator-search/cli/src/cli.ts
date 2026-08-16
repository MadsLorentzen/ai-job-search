#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Y Combinator's "Work at a Startup"
// (workatastartup.com) public pages. No external CLI framework, zero runtime
// dependencies — runs anywhere `bun` is available.
//
// Personal use only. This reads Work at a Startup's public job pages; keep volume
// low and do not use it commercially or for bulk data collection.

import { ROLE_SLUGS } from "./helpers.js"
import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", r: "role" }
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

const HELP = `ycombinator-cli — search jobs on Y Combinator's Work at a Startup (workatastartup.com)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>    Keywords (title, role, company). Filtered client-side.
  --location, -l <text> Location substring, e.g. "Remote", "India", "Bangalore".
  --role, -r <slug>     Restrict to one role category (see ROLES below).
  --jobage <days>       Accepted but ignored — the portal exposes no posting date.
  --page <n>            1-indexed page (${20} results/page, client-side). Default 1.
  --limit, -n <n>       Cap results emitted (client-side).
  --format <fmt>        json (default) | table | plain.

ROLES
  ${ROLE_SLUGS.join(", ")}

NOTES
  Work at a Startup has no public keyword-search API and no pagination: each role
  category returns a fixed set (~25-30 jobs). With --query or --location the CLI
  fetches all ${ROLE_SLUGS.length} categories and filters/pages the union client-side. With --role
  it fetches just that category. With neither it returns the default listing.

EXAMPLES
  bun run src/cli.ts search -q "data analyst" --format table
  bun run src/cli.ts search -q "data" -l "Remote" --limit 10 --format table
  bun run src/cli.ts search -r science --format table
  bun run src/cli.ts search -q "engineer" -l "India" --format json
  bun run src/cli.ts detail 72052 --format plain

Personal use only — uses Work at a Startup's public pages; keep volume low.
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

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
        )
        return null
      }
      return val
    }

    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, v)
    }
    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
    }

    const role = typeof flags.role === "string" ? flags.role : undefined
    if (role && !(ROLE_SLUGS as readonly string[]).includes(role)) {
      process.stderr.write(
        JSON.stringify({
          error: `unknown --role "${role}". Valid roles: ${ROLE_SLUGS.join(", ")}`,
          code: "BAD_ROLE",
        }) + "\n",
      )
      return 1
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      role,
      page,
      limit,
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

main().then((code) => process.exit(code))
