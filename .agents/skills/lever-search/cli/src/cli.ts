#!/usr/bin/env bun
// Self-contained CLI for searching a company's Lever job postings.
// Zero runtime dependencies — runs anywhere `bun` is available.
//
// Lever publishes this postings API for public use (it is what company careers
// pages are built on) and requires no key.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { runDiscover, type DiscoverOpts } from "./commands/discover.js"
import { parseSites, loadRegistry } from "./helpers.js"

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

const HELP = `lever-cli — search Lever job postings, by role or by company

Lever has NO cross-company search API. Role-first search is therefore done by
sweeping a registry of known site slugs concurrently and filtering titles
locally — that is what --registry does.

USAGE
  bun run src/cli.ts search --registry -q "<role>" [flags]        # role-first
  bun run src/cli.ts search --company <site>[,<site>...] [flags]  # company-first
  bun run src/cli.ts detail <uuid|url> [--company <site>] [--format json|plain]
  bun run src/cli.ts discover <company-name>... [--dry-run]       # grow the registry

SEARCH FLAGS
  --registry              Sweep every site in .agents/ats-registry/companies.json.
                          Use INSTEAD of --company for role-first search.
  --company, -c <list>    Lever site slug(s), comma-separated.
                          e.g. "palantir" or "palantir,plaid"
                          One of --registry or --company is required.
  --concurrency <n>       Parallel site fetches. Default 8, max 16.
  --us-remote             Only US-eligible remote roles (reads workplaceType +
                          the ISO-2 country field; excludes non-US remote).
  --query, -q <text>      Keywords. Filtered CLIENT-SIDE over the job title
                          (Lever has no keyword parameter).
  --location, -l <text>   Client-side location filter. "Remote" also matches on
                          Lever's workplaceType field.
  --team <text>           SERVER-SIDE filter, e.g. "Engineering". Exact match.
  --commitment <text>     SERVER-SIDE filter, e.g. "Full-time". Exact match.
  --remote [mode]         Filter on workplaceType: remote | hybrid | onsite.
                          Bare --remote means --remote remote.
  --jobage <days>         Posted within N days (client-side, on createdAt).
  --page <n>              1-indexed page, 25 results/page (client-side).
  --limit, -n <n>         Cap results emitted.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  # Role-first across every known site
  bun run src/cli.ts search --registry -q "senior software engineer" -l "Remote" --format table
  bun run src/cli.ts discover "Modern Treasury" Ramp --dry-run
  # Company-first
  bun run src/cli.ts search -c palantir -q "engineer" --format table
  bun run src/cli.ts search -c palantir --team "Engineering" --remote remote --format table
  bun run src/cli.ts search -c "palantir,plaid" -q "data" --jobage 30 --format table
  bun run src/cli.ts detail https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c --format plain

Finding a site slug: open the company's careers page and look for
jobs.lever.co/<slug> in the URL or the embedded iframe.
`

/** Bounded parallelism: fast registry sweeps without tripping rate limits. */
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
          error: "discover needs at least one company name, e.g. discover \"Modern Treasury\" Ramp",
          code: "NO_CANDIDATES",
        }) + "\n",
      )
      return 1
    }
    const dfmt = (flags.format as string) || "table"
    const dopts: DiscoverOpts = {
      candidates: names,
      concurrency: clampConcurrency(flags.concurrency),
      dryRun: flags["dry-run"] === true || flags.dryRun === true,
      format: (["json", "table", "plain"].includes(dfmt) ? dfmt : "table") as DiscoverOpts["format"],
    }
    return runDiscover(dopts)
  }

  if (cmd === "search") {
    const companyRaw = typeof flags.company === "string" ? flags.company : undefined
    let sites = companyRaw ? parseSites(companyRaw) : []

    if (flags.registry === true) {
      const fromRegistry = await loadRegistry("lever")
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
      sites = Array.from(new Set([...fromRegistry, ...sites]))
    }

    if (sites.length === 0) {
      process.stderr.write(
        JSON.stringify({
          error:
            'pass --registry for a role-first sweep of all known sites, or --company/-c with a Lever site slug (e.g. -c palantir). Lever has no cross-company search API.',
          code: "NO_COMPANY",
        }) + "\n",
      )
      return 1
    }

    // A bare `--remote` (no value) parses to boolean true. Treat it as the
    // unambiguous `--remote remote` rather than silently skipping the filter —
    // a no-op that returns onsite jobs is worse than either erroring or working.
    const remote =
      flags.remote === true
        ? "remote"
        : typeof flags.remote === "string"
          ? flags.remote.toLowerCase()
          : undefined
    if (remote && !["remote", "hybrid", "onsite", "on-site"].includes(remote)) {
      process.stderr.write(
        JSON.stringify({
          error: `--remote must be one of remote|hybrid|onsite, got "${remote}"`,
          code: "BAD_ARG",
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
      sites,
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      team: typeof flags.team === "string" ? flags.team : undefined,
      commitment: typeof flags.commitment === "string" ? flags.commitment : undefined,
      remote,
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
