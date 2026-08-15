#!/usr/bin/env bun
// CLI for searching BOSS直聘 through the user's logged-in Chrome session (CDP).
// Read-only (search + detail). Zero runtime dependencies beyond bun.
//
// Personal use only: drives your own logged-in session to read listings.
// Keep volume low; do not use it to automate applications.

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

const HELP = `zhipin-cli — search BOSS直聘 through your logged-in Chrome session (read-only)

USAGE
  bun run src/cli.ts search -q "<keywords>" [-l <city|code>] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>    Keywords (job title / skill). Recommended.
  --location, -l <...>  City name (上海/北京/杭州/...) or raw city code
                        (e.g. 101020100). Optional; omit to search nationwide.
  --page <n>            1-indexed page. Default 1.
  --limit, -n <n>       Cap results emitted (client-side).
  --format <fmt>        json (default) | table | plain.

REQUIRES
  Chrome running with remote debugging AND logged into BOSS直聘, e.g.:
    open -a "Google Chrome" --args --remote-debugging-port=9222 \\
        --remote-allow-origins=* --user-data-dir="$HOME/zhipin-chrome-profile"

EXAMPLES
  bun run src/cli.ts search -q "算法工程师" -l 上海 --format table
  bun run src/cli.ts search -q "AI平台" -l 101020100 --limit 20 --format json
  bun run src/cli.ts detail f902a6107a7a3a6b0nF839q0GVBW --format plain

Personal use only — read-only search through your own session. No auto-apply.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (flags.help || flags.h) {
    process.stdout.write(HELP)
    return 0
  }
  if (!cmd) {
    process.stdout.write(HELP)
    return 1
  }

  const parseNum = (
    name: string,
    raw: string | boolean | string[],
  ): number | null => {
    const v = parseInt(raw as string, 10)
    if (isNaN(v)) {
      process.stderr.write(
        JSON.stringify({
          error: `--${name} must be a number, got "${raw}"`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return null
    }
    return v
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"
    if (flags.page !== undefined) {
      const v = parseNum("page", flags.page)
      if (v === null) return 1
      flags.page = String(v)
    }
    if (flags.limit !== undefined) {
      const v = parseNum("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location:
        typeof flags.location === "string" ? flags.location : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt)
        ? fmt
        : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) +
          "\n",
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

  process.stderr.write(
    JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) +
      "\n",
  )
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
