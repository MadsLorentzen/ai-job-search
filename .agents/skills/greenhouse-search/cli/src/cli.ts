#!/usr/bin/env bun
// Self-contained CLI for searching a company's Greenhouse job board.
// Zero runtime dependencies — runs anywhere `bun` is available.
//
// Greenhouse publishes this Job Board API for public use (it is what company
// careers pages are built on) and requires no key.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { runDiscover, type DiscoverOpts } from "./commands/discover.js"
import { parseBoards, loadRegistry } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = {
    q: "query",
    l: "location",
    n: "limit",
    c: "company",
  }
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

const HELP = `greenhouse-cli — search Greenhouse job boards, by role or by company

Greenhouse has NO cross-company search API. Role-first search is therefore done
by sweeping a registry of known board slugs concurrently and filtering titles
locally — that is what --registry does.

USAGE
  bun run src/cli.ts search --registry -q "<role>" [flags]        # role-first
  bun run src/cli.ts search --company <token>[,<token>...] [flags] # company-first
  bun run src/cli.ts detail <id|url> [--company <token>] [--format json|plain]
  bun run src/cli.ts discover <company-name>... [--dry-run]       # grow the registry

SEARCH FLAGS
  --registry              Sweep every board in .agents/ats-registry/companies.json.
                          Use INSTEAD of --company for role-first search.
  --company, -c <list>    Board token(s), comma-separated.
                          e.g. "stripe" or "stripe,databricks,figma"
                          One of --registry or --company is required.
  --concurrency <n>       Parallel board fetches. Default 8, max 16.
  --us-remote             Only US-eligible remote roles. Prefer this over
                          -l "Remote": US remote is spelled at least four ways
                          ("Remote - US", "Remote US", "Remote - United States"),
                          so no single -l value catches them all, while plain
                          -l "Remote" wrongly admits Remote Canada/Poland/Spain.
  --query, -q <text>      Keywords. Filtered CLIENT-SIDE over the job title
                          (Greenhouse has no search parameter).
  --location, -l <text>   Client-side location filter. "Remote" also matches
                          "Remote - US", "Anywhere", "Distributed".
  --jobage <days>         Posted within N days (client-side).
  --page <n>              1-indexed page, 25 results/page (paginated client-side).
  --limit, -n <n>         Cap results emitted.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  # Role-first: every known board, Go roles, remote
  bun run src/cli.ts search --registry -q "golang" -l "Remote" --format table
  bun run src/cli.ts search --registry -q "staff engineer" --jobage 14 --format table
  # Company-first
  bun run src/cli.ts search -c stripe -q "engineer" -l "Remote" --format table
  bun run src/cli.ts search -c "stripe,databricks" -q "data" --jobage 30 --format table
  # Detail + registry growth
  bun run src/cli.ts detail 8023928 --company stripe --format plain
  bun run src/cli.ts discover "Modern Treasury" Wise Ramp --dry-run

Finding a board token: open the company's careers page and look for
boards.greenhouse.io/<token> or job-boards.greenhouse.io/<token> in the URL or
the embedded iframe.
`

/** Bounded parallelism: enough to make a full registry sweep fast, polite enough not to trip limits. */
function clampConcurrency(raw: string | boolean | string[] | undefined): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : NaN
  if (!Number.isFinite(n) || n <= 0) return 8
  return Math.min(n, 16)
}

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

  if (cmd === "discover") {
    const names = (flags._ as string[]).slice(1)
    if (names.length === 0) {
      process.stderr.write(
        JSON.stringify({
          error: "discover needs at least one company name, e.g. discover \"Modern Treasury\" Wise",
          code: "NO_CANDIDATES",
        }) + "\n",
      )
      return 1
    }
    if (flags.concurrency !== undefined) {
      const v = parseIntFlag("concurrency", flags.concurrency)
      if (v === null) return 1
      flags.concurrency = String(v)
    }
    const fmt = (flags.format as string) || "table"
    const opts: DiscoverOpts = {
      candidates: names,
      concurrency: clampConcurrency(flags.concurrency),
      dryRun: flags["dry-run"] === true || flags.dryRun === true,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "table") as DiscoverOpts["format"],
    }
    return runDiscover(opts)
  }

  if (cmd === "search") {
    const companyRaw = typeof flags.company === "string" ? flags.company : undefined
    let boards = companyRaw ? parseBoards(companyRaw) : []

    // --registry sweeps every known board; it is what makes role-first search work.
    if (flags.registry === true) {
      const fromRegistry = await loadRegistry("greenhouse")
      if (fromRegistry.length === 0) {
        process.stderr.write(
          JSON.stringify({
            error:
              "--registry was passed but the registry is empty or missing (.agents/ats-registry/companies.json). Seed it with the discover command, or pass --company instead.",
            code: "EMPTY_REGISTRY",
          }) + "\n",
        )
        return 1
      }
      // Union, so --registry and --company can be combined.
      boards = Array.from(new Set([...fromRegistry, ...boards]))
    }

    if (boards.length === 0) {
      process.stderr.write(
        JSON.stringify({
          error:
            'pass --registry for a role-first sweep of all known boards, or --company/-c with a Greenhouse board token (e.g. -c stripe). Greenhouse has no cross-company search API.',
          code: "NO_COMPANY",
        }) + "\n",
      )
      return 1
    }

    for (const name of ["jobage", "page", "limit", "concurrency"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      boards,
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      usRemote: flags["us-remote"] === true || flags.usRemote === true,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      concurrency: clampConcurrency(flags.concurrency),
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
    const opts: DetailOpts = {
      id,
      board: typeof flags.company === "string" ? flags.company.split(",")[0]!.trim() : undefined,
      format: fmt === "plain" ? "plain" : "json",
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
