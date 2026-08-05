#!/usr/bin/env bun
// Self-contained CLI for searching USAJOBS, the official US federal job board.
// Zero runtime dependencies — runs anywhere `bun` is available.
//
// ⚠️ Requires a free API key. Set USAJOBS_API_KEY and USAJOBS_EMAIL in your
// environment; register at https://developer.usajobs.gov/apirequest/

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { readCredentials, MISSING_CREDENTIALS_MESSAGE } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", t: "title" }
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

const HELP = `usajobs-cli — search USAJOBS, the official US federal job board

REQUIRES A FREE API KEY (this is the only portal here that authenticates):
  1. Register at https://developer.usajobs.gov/apirequest/
  2. export USAJOBS_API_KEY="<key from the email>"
     export USAJOBS_EMAIL="<the email you registered>"

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <control-number|announcement-number|url> [--format json|plain]

SEARCH FLAGS  (all filters are genuinely server-side here)
  --query, -q <text>      Keyword across the whole announcement.
  --title, -t <text>      Match within the job title only ("contains").
  --location, -l <text>   City, e.g. "Austin, Texas". Note USAJOBS wants the
                          full state name, not an abbreviation.
  --organization <code>   Agency subelement code, e.g. "TR" for Treasury.
  --remote                Only remote/telework-eligible jobs.
  --onsite                Exclude remote jobs.
  --jobage <days>         Posted within N days. API maximum is 60 (clamped).
  --page <n>              1-indexed page.
  --limit, -n <n>         Results per page, up to 500. Default 25.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "data scientist" --remote --format table
  bun run src/cli.ts search -t "Software Engineer" -l "Austin, Texas" --format table
  bun run src/cli.ts search -q "economist" --jobage 14 -n 50 --format table
  bun run src/cli.ts detail 828810900 --format plain

Only CURRENTLY OPEN announcements are returned — closed postings are not in this API.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd !== "search" && cmd !== "detail") {
    process.stderr.write(
      JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n",
    )
    return 1
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

  // Validate flags BEFORE demanding credentials, so a typo reports as a typo
  // rather than as a missing key.
  if (cmd === "search") {
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }
    if (flags.remote && flags.onsite) {
      process.stderr.write(
        JSON.stringify({
          error: "--remote and --onsite are mutually exclusive",
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }
  }

  let detailId: string | undefined
  if (cmd === "detail") {
    detailId = (flags._ as string[])[1]
    if (!detailId) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n",
      )
      return 1
    }
  }

  const creds = readCredentials(process.env as Record<string, string | undefined>)
  if (!creds) {
    process.stderr.write(
      JSON.stringify({ error: MISSING_CREDENTIALS_MESSAGE, code: "NO_CREDENTIALS" }) + "\n",
    )
    return 1
  }

  const fmt = (flags.format as string) || "json"

  if (cmd === "search") {
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      title: typeof flags.title === "string" ? flags.title : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      organization: typeof flags.organization === "string" ? flags.organization : undefined,
      remote: flags.remote ? true : flags.onsite ? false : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts, creds)
  }

  const opts: DetailOpts = {
    id: detailId!,
    format: fmt === "plain" ? "plain" : "json",
  }
  return runDetail(opts, creds)
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
