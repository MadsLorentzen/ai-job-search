#!/usr/bin/env bun
import { runDetail } from "./commands/detail.js"
import { runSearch } from "./commands/search.js"
import { writeError } from "./helpers.js"

type Flags = { _: string[]; [key: string]: string | boolean | string[] }
const ALIASES: Record<string, string> = { q: "query", n: "limit", c: "city", p: "page", f: "format" }
const KNOWN: Record<string, Set<string>> = {
  search: new Set(["query", "city", "page", "limit", "jobage", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("-")) { flags._.push(arg); continue }
    const raw = arg.replace(/^-+/, "")
    const [name, inline] = raw.split("=", 2)
    const key = ALIASES[name] ?? name
    const next = argv[i + 1]
    if (inline !== undefined) flags[key] = inline
    else if (next && !next.startsWith("-")) { flags[key] = next; i++ }
    else flags[key] = true
  }
  return flags
}

function numberFlag(flags: Flags, name: string, min = 1): number | null {
  const raw = flags[name]
  if (raw === undefined) return null
  const value = typeof raw === "string" ? Number(raw) : Number.NaN
  if (!Number.isInteger(value) || value < min) { writeError(`--${name} must be an integer >= ${min}`, "BAD_ARG"); return null }
  return value
}

const HELP = `zhaopin-search — read-only public Zhaopin job pages\n\nUSAGE\n  bun run src/cli.ts search --query <text> [--city <city>] [--page <n>] [--limit <n>] [--format json|table|plain]\n  bun run src/cli.ts detail <id|url> [--format json|plain]\n`

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const command = flags._[0]
  if (!command || flags.help || flags.h) { process.stdout.write(HELP); return command ? 0 : 1 }
  const known = KNOWN[command]
  if (!known) { writeError(`Unknown command "${command}"`, "BAD_CMD"); return 1 }
  for (const key of Object.keys(flags)) if (key !== "_" && !known.has(key)) { writeError(`unknown flag --${key} for '${command}'`, "UNKNOWN_FLAG"); return 1 }
  if (command === "search") {
    if (typeof flags.query !== "string" || !flags.query.trim()) { writeError("--query is required", "MISSING_REQUIRED"); return 1 }
    const pageFlag = numberFlag(flags, "page"); if (flags.page !== undefined && pageFlag === null) return 1
    const limit = numberFlag(flags, "limit"); if (flags.limit !== undefined && limit === null) return 1
    const jobage = numberFlag(flags, "jobage"); if (flags.jobage !== undefined && jobage === null) return 1
    if (flags.format !== undefined && (typeof flags.format !== "string" || !["json", "table", "plain"].includes(flags.format))) {
      writeError("--format must be one of json|table|plain", "BAD_ARG")
      return 1
    }
    const format = (flags.format as "json" | "table" | "plain" | undefined) ?? "json"
    const page = pageFlag ?? 1
    return runSearch({ query: flags.query, city: typeof flags.city === "string" ? flags.city : undefined, page, limit: limit ?? undefined, jobage: jobage ?? undefined, format })
  }
  const id = flags._[1]; if (!id) { writeError("detail requires an <id|url>", "MISSING_REQUIRED"); return 1 }
  if (flags.format !== undefined && (typeof flags.format !== "string" || !["json", "plain"].includes(flags.format))) {
    writeError("--format must be one of json|plain for detail", "BAD_ARG")
    return 1
  }
  const format = flags.format === "plain" ? "plain" : "json"
  return runDetail(id, format)
}

main().then((code) => process.exit(code)).catch((error) => { writeError(error instanceof Error ? error.message : String(error), "INTERNAL_ERROR"); process.exit(1) })
