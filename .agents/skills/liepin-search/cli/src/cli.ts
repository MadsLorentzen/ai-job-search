#!/usr/bin/env bun
import { runSearch } from "./commands/search.js"
import { runDetail } from "./commands/detail.js"
import { writeError } from "./helpers.js"

type Flags = { _: string[]; [key: string]: string | boolean | string[] }
const ALIASES: Record<string, string> = { q: "query", c: "city", p: "page", n: "limit", f: "format" }
const KNOWN: Record<string, Set<string>> = {
  search: new Set(["query", "city", "page", "limit", "format", "help", "h"]),
  detail: new Set(["help", "h"]),
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith("-")) { flags._.push(arg); continue }
    const [rawName, inline] = arg.replace(/^-+/, "").split("=", 2)
    const name = ALIASES[rawName] ?? rawName
    const next = argv[index + 1]
    if (inline !== undefined) flags[name] = inline
    else if (next && !next.startsWith("-")) { flags[name] = next; index++ }
    else flags[name] = true
  }
  return flags
}

function integerFlag(flags: Flags, name: string, min: number): number | null {
  if (flags[name] === undefined) return null
  const value = typeof flags[name] === "string" ? Number(flags[name]) : Number.NaN
  if (!Number.isInteger(value) || value < min) { writeError(`--${name} must be an integer >= ${min}`, "BAD_ARG"); return null }
  return value
}

const HELP = `liepin-search — read-only Liepin job search via official liepin-cli\n\nUSAGE\n  bun run src/cli.ts search --query <text> [--city <city>] [--page <n>] [--limit <n>] [--format json|table|plain]\n  bun run src/cli.ts detail <id-or-url>\n`

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const command = flags._[0]
  if (!command || flags.help || flags.h) { process.stdout.write(HELP); return command ? 0 : 1 }
  const known = KNOWN[command]
  if (!known) { writeError(`Unknown command "${command}"`, "BAD_CMD"); return 1 }
  for (const key of Object.keys(flags)) if (key !== "_" && !known.has(key)) { writeError(`unknown flag --${key} for '${command}'`, "UNKNOWN_FLAG"); return 1 }
  if (command === "detail") return runDetail(flags._[1])
  if (typeof flags.query !== "string" || !flags.query.trim()) { writeError("--query is required", "MISSING_REQUIRED"); return 1 }
  const page = integerFlag(flags, "page", 1); if (flags.page !== undefined && page === null) return 1
  const limit = integerFlag(flags, "limit", 1); if (flags.limit !== undefined && limit === null) return 1
  if (flags.format !== undefined && (typeof flags.format !== "string" || !["json", "table", "plain"].includes(flags.format))) { writeError("--format must be one of json|table|plain", "BAD_ARG"); return 1 }
  return runSearch({ query: flags.query, city: typeof flags.city === "string" ? flags.city : undefined, page: page ?? 1, limit: limit ?? undefined, format: (flags.format as "json" | "table" | "plain" | undefined) ?? "json" })
}

main().then((code) => process.exit(code)).catch((error) => { writeError(error instanceof Error ? error.message : String(error), "INTERNAL_ERROR"); process.exit(1) })
