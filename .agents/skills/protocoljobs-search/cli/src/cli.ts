#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Protocol Jobs (protocoljobs.ai), an
// India-focused tech/white-collar job aggregator. Uses the site's public JSON API
// with zero runtime dependencies, so it runs anywhere `bun` is available.
//
// Personal use only. This reads Protocol Jobs' public API; keep volume low and do
// not use it commercially or for bulk data collection. Run it on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", d: "domain" }
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

const HELP = `protocoljobs-cli — search jobs on Protocol Jobs (protocoljobs.ai, India tech roles)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, or role). e.g. "data analyst".
  --location, -l <text>   City or mode: Bengaluru, Mumbai, Pune, Delhi NCR, Gurugram,
                          Noida, Hyderabad, Chennai, Kolkata, Ahmedabad, Remote, Hybrid.
  --domain, -d <text>     Job domain: data, ml/ai, backend, frontend, fullstack, qa,
                          devops, cloud, mobile, product, design, pm.
  --jobage <days>         Posted within N days (mapped to nearest bucket: 2/3/7/14/28).
  --page <n>              1-indexed page (20 results/page; higher pages walk the cursor).
  --limit, -n <n>         Cap results emitted / page size (client-side, max 100).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "data analyst" -l "Bengaluru" --format table
  bun run src/cli.ts search -q "power bi" -l "Remote" --jobage 7 --format table
  bun run src/cli.ts search -d data -l "Pune" --limit 10 --format table
  bun run src/cli.ts detail 6a58d24643dd50bdf47b3db9 --format plain

Personal use only — uses Protocol Jobs' public API; keep volume low.
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

    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      domain: typeof flags.domain === "string" ? flags.domain : undefined,
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
