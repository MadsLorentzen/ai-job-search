#!/usr/bin/env bun
// Search public Greenhouse / Lever / Ashby job boards. No API key.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      ;(flags._ as string[]).push(a)
      continue
    }
    const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("-")) {
      flags[key] = true
    } else if (key === "board") {
      const acc = Array.isArray(flags.board) ? flags.board : []
      acc.push(next)
      flags.board = acc
      i++
    } else {
      flags[key] = next
      i++
    }
  }
  return flags
}

const HELP = `ats-boards-cli — search public Greenhouse, Lever, and Ashby job boards

USAGE
  bun run src/cli.ts search --board greenhouse:<token> [--board lever:<site>] [flags]
  bun run src/cli.ts detail <kind>:<boardToken>:<jobId> [--format json|plain]

SEARCH FLAGS
  --board <kind:token>    Repeatable. kind is greenhouse | lever | ashby
  --boards-file <path>    JSON { "boards": ["greenhouse:acme", ...] }
  --query, -q <text>      Filter title/company/description (client-side)
  --location, -l <text>   Filter location substring
  --jobage <days>         Posted within N days (client-side; unknown dates kept)
  --page <n>              1-indexed page. Default 1
  --limit, -n <n>         Page size. Default 20
  --format json|table|plain   Default json

EXAMPLES
  bun run src/cli.ts search --board greenhouse:stripe -q "engineer" --format table
  bun run src/cli.ts search --board lever:netflix --board ashby:openai --jobage 14
  bun run src/cli.ts search --boards-file job_scraper/ats_boards.json -l Remote
  bun run src/cli.ts detail greenhouse:stripe:12345 --format plain

Board tokens are the public careers-page slug (stripe.greenhouse.io → stripe).
`

const KNOWN: Record<string, Set<string>> = {
  search: new Set(["board", "boards-file", "query", "location", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function intFlag(raw: unknown, name: string): number | undefined {
  if (raw === undefined || raw === true) return undefined
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw Object.assign(new Error(`${name} must be a non-negative integer`), { code: "BAD_ARG" })
  }
  return Number(raw)
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]
  if (!cmd || cmd === "help" || flags.help || flags.h) {
    process.stdout.write(HELP)
    return 0
  }
  const known = KNOWN[cmd]
  if (!known) {
    writeError(`unknown command ${cmd}`, "BAD_ARG")
    return 1
  }
  for (const key of Object.keys(flags)) {
    if (key === "_") continue
    if (!known.has(key)) {
      writeError(`unknown flag --${key}`, "UNKNOWN_FLAG")
      return 1
    }
  }

  try {
    if (cmd === "search") {
      const formatRaw = typeof flags.format === "string" ? flags.format : "json"
      if (formatRaw !== "json" && formatRaw !== "table" && formatRaw !== "plain") {
        throw Object.assign(new Error("format must be json, table, or plain"), { code: "BAD_ARG" })
      }
      const boards = Array.isArray(flags.board) ? flags.board : typeof flags.board === "string" ? [flags.board] : []
      const opts: SearchOpts = {
        query: typeof flags.query === "string" ? flags.query : undefined,
        location: typeof flags.location === "string" ? flags.location : undefined,
        jobage: intFlag(flags.jobage, "jobage"),
        limit: intFlag(flags.limit, "limit"),
        page: intFlag(flags.page, "page"),
        boards,
        boardsFile: typeof flags["boards-file"] === "string" ? flags["boards-file"] : undefined,
        format: formatRaw,
      }
      await runSearch(opts)
      return 0
    }
    const target = (flags._ as string[])[1]
    if (!target) {
      writeError("detail requires kind:boardToken:jobId", "BAD_ARG")
      return 1
    }
    const formatRaw = typeof flags.format === "string" ? flags.format : "plain"
    const opts: DetailOpts = { target, format: formatRaw === "json" ? "json" : "plain" }
    await runDetail(opts)
    return 0
  } catch (e) {
    const err = e as Error & { code?: string }
    writeError(err.message, err.code ?? "ERROR")
    return 1
  }
}

main().then((code) => process.exit(code))
