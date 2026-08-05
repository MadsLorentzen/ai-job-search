#!/usr/bin/env bun
// Self-contained CLI for searching We Work Remotely's public RSS feeds.
// Zero runtime dependencies — runs anywhere `bun` is available.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CATEGORIES, resolveCategory } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "region", n: "limit" }
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

const HELP = `weworkremotely-cli — search remote jobs on We Work Remotely (RSS)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--category <slug>] [--format json|plain]

SEARCH FLAGS
  --category <slug>       SERVER-SIDE — picks a narrower feed. One of:
                            ${CATEGORIES.join("\n                            ")}
                          Short forms work too: "programming", "design".
  --query, -q <text>      Keywords (client-side, over title/company/skills).
  --region, -l <text>     Eligibility region, e.g. "USA", "Anywhere".
                          "USA" also matches "Anywhere in the World" listings.
  --jobage <days>         Posted within N days.
  --page <n>              1-indexed page, 25 results/page.
  --limit, -n <n>         Cap results emitted.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search --category remote-programming-jobs --format table
  bun run src/cli.ts search --category programming -q "senior" --format table
  bun run src/cli.ts search -l "USA" --jobage 7 --format table
  bun run src/cli.ts detail some-company-senior-engineer --format plain

Each RSS feed is a fixed-size recent window (~100 items), not a paginated
archive — older postings drop out of it entirely.
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

  // Resolve the category for both commands; an unknown one is a hard error
  // rather than a silent fall back to the all-jobs feed.
  let category: string | undefined
  if (typeof flags.category === "string") {
    const resolved = resolveCategory(flags.category)
    if (!resolved) {
      process.stderr.write(
        JSON.stringify({
          error: `unknown category "${flags.category}". Valid: ${CATEGORIES.join(", ")}`,
          code: "BAD_CATEGORY",
        }) + "\n",
      )
      return 1
    }
    category = resolved
  }

  if (cmd === "search") {
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      category,
      region: typeof flags.region === "string" ? flags.region : undefined,
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
    const opts: DetailOpts = { id, category, format: fmt === "plain" ? "plain" : "json" }
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
