#!/usr/bin/env bun
import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit" }
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
    } else if (key === "feed") {
      const acc = Array.isArray(flags.feed) ? flags.feed : []
      acc.push(next)
      flags.feed = acc
      i++
    } else {
      flags[key] = next
      i++
    }
  }
  return flags
}

const HELP = `rss-cli — search RSS/Atom job feeds (company blogs, boards that still publish XML)

USAGE
  bun run src/cli.ts search --feed <url> [--feed <url>] [flags]
  bun run src/cli.ts detail <item-url> --feed <url>

SEARCH FLAGS
  --feed <url>            Repeatable feed URL
  --feeds-file <path>     JSON { "feeds": ["https://..."] } or one URL per line
  --query, -q <text>      Client-side title/description filter
  --jobage <days>         Client-side recency filter
  --page <n> --limit, -n <n> --format json|table|plain
`

const KNOWN: Record<string, Set<string>> = {
  search: new Set(["feed", "feeds-file", "query", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["feed", "format", "help", "h"]),
}

function intFlag(raw: unknown, name: string): number | undefined {
  if (raw === undefined || raw === true) return undefined
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw Object.assign(new Error(`${name} must be a non-negative integer`), { code: "BAD_ARG" })
  }
  return Number(raw)
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
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
    const feeds = Array.isArray(flags.feed) ? flags.feed : typeof flags.feed === "string" ? [flags.feed] : []
    if (cmd === "search") {
      const formatRaw = typeof flags.format === "string" ? flags.format : "json"
      if (formatRaw !== "json" && formatRaw !== "table" && formatRaw !== "plain") {
        throw Object.assign(new Error("format must be json, table, or plain"), { code: "BAD_ARG" })
      }
      const opts: SearchOpts = {
        query: typeof flags.query === "string" ? flags.query : undefined,
        jobage: intFlag(flags.jobage, "jobage"),
        limit: intFlag(flags.limit, "limit"),
        page: intFlag(flags.page, "page"),
        feeds,
        feedsFile: typeof flags["feeds-file"] === "string" ? flags["feeds-file"] : undefined,
        format: formatRaw,
      }
      await runSearch(opts)
      return 0
    }
    const target = (flags._ as string[])[1]
    if (!target) {
      writeError("detail requires an item URL", "BAD_ARG")
      return 1
    }
    const opts: DetailOpts = {
      target,
      feed: typeof flags.feed === "string" ? flags.feed : feeds[0],
      format: flags.format === "json" ? "json" : "plain",
    }
    await runDetail(opts)
    return 0
  } catch (e) {
    const err = e as Error & { code?: string }
    writeError(err.message, err.code ?? "ERROR")
    return 1
  }
}

main().then((code) => process.exit(code))
