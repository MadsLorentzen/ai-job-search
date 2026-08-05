#!/usr/bin/env bun
// Self-contained CLI for searching a company's Lever job postings.
// Zero runtime dependencies — runs anywhere `bun` is available.
//
// Lever publishes this postings API for public use (it is what company careers
// pages are built on) and requires no key.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { parseSites } from "./helpers.js"

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

const HELP = `lever-cli — search a company's Lever job postings (US + global)

Lever has NO cross-company search: you search one company's posting site at a
time, by its slug (jobs.lever.co/<site>). Use themuse-search for open-ended
discovery; use this to work a target-company list.

USAGE
  bun run src/cli.ts search --company <site>[,<site>...] [flags]
  bun run src/cli.ts detail <uuid|url> [--company <site>] [--format json|plain]

SEARCH FLAGS
  --company, -c <list>    REQUIRED. Lever site slug(s), comma-separated.
                          e.g. "palantir" or "palantir,plaid"
  --query, -q <text>      Keywords. Filtered CLIENT-SIDE over the job title
                          (Lever has no keyword parameter).
  --location, -l <text>   Client-side location filter. "Remote" also matches on
                          Lever's workplaceType field.
  --team <text>           SERVER-SIDE filter, e.g. "Engineering". Exact match.
  --commitment <text>     SERVER-SIDE filter, e.g. "Full-time". Exact match.
  --remote <mode>         Filter on workplaceType: remote | hybrid | onsite.
  --jobage <days>         Posted within N days (client-side, on createdAt).
  --page <n>              1-indexed page, 25 results/page (client-side).
  --limit, -n <n>         Cap results emitted.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -c palantir -q "engineer" --format table
  bun run src/cli.ts search -c palantir --team "Engineering" --remote remote --format table
  bun run src/cli.ts search -c "palantir,plaid" -q "data" --jobage 30 --format table
  bun run src/cli.ts detail https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c --format plain

Finding a site slug: open the company's careers page and look for
jobs.lever.co/<slug> in the URL or the embedded iframe.
`

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

  if (cmd === "search") {
    const companyRaw = typeof flags.company === "string" ? flags.company : undefined
    const sites = companyRaw ? parseSites(companyRaw) : []
    if (sites.length === 0) {
      process.stderr.write(
        JSON.stringify({
          error:
            'the --company/-c flag is required (a Lever site slug, e.g. -c palantir, or a comma-separated list). Lever has no cross-company search.',
          code: "NO_COMPANY",
        }) + "\n",
      )
      return 1
    }

    const remote = typeof flags.remote === "string" ? flags.remote.toLowerCase() : undefined
    if (remote && !["remote", "hybrid", "onsite", "on-site"].includes(remote)) {
      process.stderr.write(
        JSON.stringify({
          error: `--remote must be one of remote|hybrid|onsite, got "${remote}"`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }

    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      sites,
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      team: typeof flags.team === "string" ? flags.team : undefined,
      commitment: typeof flags.commitment === "string" ? flags.commitment : undefined,
      remote,
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
      process.stderr.write(
        JSON.stringify({ error: "detail requires an <uuid|url>", code: "NO_ID" }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      site: typeof flags.company === "string" ? flags.company.split(",")[0]!.trim() : undefined,
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
