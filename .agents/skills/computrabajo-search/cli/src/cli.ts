#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Computrabajo Colombia
// (co.computrabajo.com). No external CLI framework, so it runs anywhere `bun`
// is available with zero install beyond the repo clone.
//
// Respects the portal's robots.txt: only the document fetch of page 1 of a
// keyword search is used; the Ajax-based paginator (/Ajax/*) is disallowed,
// so --page 2+ is rejected. Keep volume low.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit" }
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

const HELP = `computrabajo-cli — search jobs on Computrabajo Colombia (co.computrabajo.com)

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts detail <url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Keywords (job title or skill). REQUIRED, e.g. "desarrollador
                         backend", "analista de datos", "frontend react".
  --page <n>             1-indexed page. Only 1 is supported: Computrabajo's real
                         paginator is Ajax-based (/Ajax/* is disallowed by its
                         robots.txt), so --page 2+ exits with UNSUPPORTED_PAGINATION.
  --limit, -n <n>        Cap results emitted (client-side).
  --format <fmt>         json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "desarrollador backend" --format table
  bun run src/cli.ts search -q "analista de datos" -n 5
  bun run src/cli.ts detail "https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-backend-E92595FF9C5126D461373E686DCF3405" --format plain

The detail <url> must be the full posting URL from search results: Computrabajo's
address includes the job slug, so a bare id cannot address the page.
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
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      process.stderr.write(
        JSON.stringify({
          error: "the --query/-q flag is required (e.g. -q \"desarrollador backend\")",
          code: "NO_QUERY",
        }) + "\n",
      )
      return 1
    }

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n")
        return null
      }
      return val
    }

    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      if (v > 1) {
        process.stderr.write(
          JSON.stringify({
            error: `--page ${v} is unsupported: Computrabajo's paginator is Ajax-based (/Ajax/* is disallowed by its robots.txt), so this CLI fetches page 1 only`,
            code: "UNSUPPORTED_PAGINATION",
          }) + "\n",
        )
        return 1
      }
      flags.page = String(v)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      query,
      page: 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const input = (flags._ as string[])[1]
    if (!input) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      input,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
    }
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