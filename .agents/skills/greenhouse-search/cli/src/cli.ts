#!/usr/bin/env bun
// Self-contained CLI for searching a company's Greenhouse job board.
// Zero runtime dependencies — runs anywhere `bun` is available.
//
// Greenhouse publishes this Job Board API for public use (it is what company
// careers pages are built on) and requires no key.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { parseBoards } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = {
    q: "query",
    l: "location",
    n: "limit",
    c: "company",
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

const HELP = `greenhouse-cli — search a company's Greenhouse job board (US + global)

Greenhouse has NO cross-company search: you search one company's board at a time,
by its board token (the slug in boards.greenhouse.io/<token>). Use themuse-search
for open-ended discovery; use this to work a target-company list.

USAGE
  bun run src/cli.ts search --company <token>[,<token>...] [flags]
  bun run src/cli.ts detail <id|url> [--company <token>] [--format json|plain]

SEARCH FLAGS
  --company, -c <list>    REQUIRED. Board token(s), comma-separated.
                          e.g. "stripe" or "stripe,databricks,figma"
  --query, -q <text>      Keywords. Filtered CLIENT-SIDE over the job title
                          (Greenhouse has no search parameter).
  --location, -l <text>   Client-side location filter. "Remote" also matches
                          "Remote - US", "Anywhere", "Distributed".
  --jobage <days>         Posted within N days (client-side).
  --page <n>              1-indexed page, 25 results/page (paginated client-side).
  --limit, -n <n>         Cap results emitted.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -c stripe -q "engineer" -l "Remote" --format table
  bun run src/cli.ts search -c "stripe,databricks" -q "data" --jobage 30 --format table
  bun run src/cli.ts detail 8023928 --company stripe --format plain
  bun run src/cli.ts detail https://boards.greenhouse.io/stripe/jobs/8023928 --format plain

Finding a board token: open the company's careers page and look for
boards.greenhouse.io/<token> or job-boards.greenhouse.io/<token> in the URL or
the embedded iframe.
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
      process.stderr.write(
        JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
      )
      return null
    }
    return val
  }

  if (cmd === "search") {
    const companyRaw = typeof flags.company === "string" ? flags.company : undefined
    const boards = companyRaw ? parseBoards(companyRaw) : []
    if (boards.length === 0) {
      process.stderr.write(
        JSON.stringify({
          error:
            'the --company/-c flag is required (a Greenhouse board token, e.g. -c stripe, or a comma-separated list). Greenhouse has no cross-company search.',
          code: "NO_COMPANY",
        }) + "\n",
      )
      return 1
    }

    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      boards,
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
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
        JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      board: typeof flags.company === "string" ? flags.company.split(",")[0]!.trim() : undefined,
      format: fmt === "plain" ? "plain" : "json",
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
