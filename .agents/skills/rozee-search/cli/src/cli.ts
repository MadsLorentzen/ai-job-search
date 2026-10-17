#!/usr/bin/env bun

import { runDetail, type DetailOpts } from "./commands/detail.js"
import { runSearch, type SearchOpts } from "./commands/search.js"
import { cityIdForLocation, writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [key: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const aliases: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg.startsWith("--") || arg.startsWith("-")) {
      const key = aliases[arg.replace(/^-+/, "")] ?? arg.replace(/^-+/, "")
      const next = argv[index + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        index++
      }
    } else {
      flags._.push(arg)
    }
  }
  return flags
}

const HELP = `rozee-cli — search public Rozee.pk job listings in Pakistan

USAGE
  bun run src/cli.ts search [--query "<keywords>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Search terms; omit for all listings
  --location, -l <city>  Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad;
                         omit to search all Pakistan
  --jobage <days>        Unsupported by Rozee and rejected
  --page <n>             1-indexed page (20 results per page)
  --limit, -n <n>        Maximum results to emit
  --format <fmt>         json (default) | table | plain

EXAMPLES
  bun run src/cli.ts search -q "Machine Learning Intern" -l Islamabad --limit 10 --format table
  bun run src/cli.ts search -q "Junior Data Analyst" --format table
  bun run src/cli.ts detail "machine-learning-intern-islamabad-jobs-123456" --format plain

Personal use only — keep volume low and do not redistribute listing content.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function positiveInteger(name: string, raw: string | boolean | string[]): number | null {
  const value = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(value) || value < 1) {
    writeError(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
    return null
  }
  return value
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const command = flags._[0]
  if (!command || flags.help || flags.h) {
    process.stdout.write(HELP)
    return command ? 0 : 1
  }

  const known = KNOWN_FLAGS[command]
  if (known) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || known.has(key)) continue
      writeError(`unknown flag --${key} for '${command}'`, "UNKNOWN_FLAG")
      return 1
    }
  }

  if (command === "search") {
    const format = flags.format === undefined ? "json" : String(flags.format)
    if (!["json", "table", "plain"].includes(format)) {
      writeError(`--format must be one of json|table|plain, got "${format}"`, "BAD_ARG")
      return 1
    }
    if (flags.jobage !== undefined) {
      writeError("Rozee does not expose a posting-age filter; omit --jobage and filter returned dates client-side", "UNSUPPORTED_FILTER")
      return 1
    }

    const location = typeof flags.location === "string" ? flags.location : undefined
    if (location && !cityIdForLocation(location)) {
      writeError(
        `Unsupported Rozee city "${location}". Omit --location for all Pakistan or use Lahore, Karachi, Islamabad, Rawalpindi, or Faisalabad.`,
        "UNKNOWN_LOCATION",
      )
      return 1
    }

    let page = 1
    let limit: number | undefined
    if (flags.page !== undefined) {
      const value = positiveInteger("page", flags.page)
      if (value === null) return 1
      page = value
    }
    if (flags.limit !== undefined) {
      const value = positiveInteger("limit", flags.limit)
      if (value === null) return 1
      limit = value
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location,
      page,
      limit,
      format: format as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (command === "detail") {
    const id = flags._[1]
    if (!id) {
      writeError("detail requires a Rozee permalink slug or job URL", "NO_ID")
      return 1
    }
    const format = flags.format === undefined ? "json" : String(flags.format)
    if (!["json", "plain"].includes(format)) {
      writeError(`--format must be one of json|plain, got "${format}"`, "BAD_ARG")
      return 1
    }
    const opts: DetailOpts = { id, format: format as DetailOpts["format"] }
    return runDetail(opts)
  }

  writeError(`Unknown command "${command}"`, "BAD_CMD")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    writeError(error instanceof Error ? error.message : String(error), "INTERNAL_ERROR")
    process.exit(1)
  })
