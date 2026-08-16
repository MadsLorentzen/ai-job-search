#!/usr/bin/env bun
// Self-contained CLI for reading job postings from Foundit (formerly Monster
// India). DETAIL-ONLY: it fetches a single posting from the robots-allowed
// /job/<slug>-<id> page and parses its schema.org JobPosting JSON-LD.
//
// Search is intentionally unsupported — Foundit's search API is disallowed by
// robots.txt and its search pages are bot-blocked. See SKILL.md / search.ts.

import { runDetail, type DetailOpts } from "./commands/detail.js"
import { runSearch } from "./commands/search.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = a.replace(/^-+/, "")
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

const HELP = `foundit-cli — read job postings from Foundit / Monster India (detail-only)

USAGE
  bun run src/cli.ts detail <id|url> [--format json|plain]

DETAIL
  <id|url>              A numeric Foundit job id (e.g. 57203413) or a full
                        https://www.foundit.in/job/<slug>-<id> URL. REQUIRED.
  --format <fmt>        json (default) | plain.

SEARCH
  Not supported. Foundit's search API is disallowed by robots.txt (/middleware/)
  and its /search/ pages return HTTP 403 to non-browser clients. Find postings
  via LinkedIn or Google (site:foundit.in) and pass the URL/id to detail.

EXAMPLES
  bun run src/cli.ts detail 57203413 --format plain
  bun run src/cli.ts detail "https://www.foundit.in/job/software-development-specialist-ntt-data-pune-57203413"
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
    return runSearch()
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
    JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n",
  )
  return 1
}

main().then((code) => process.exit(code))
