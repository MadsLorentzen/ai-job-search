#!/usr/bin/env bun
// Self-contained CLI for searching jobs and freelance missions on HelloWork
// (www.hellowork.com), the largest French generalist job board. No external CLI
// framework and zero runtime dependencies, so it runs anywhere `bun` is available.
//
// ⚠️ Personal use only. HelloWork's robots.txt disallows the search endpoint
// (`/fr-fr/emploi/recherche.html` and any URL with a query string) for generic
// user-agents. Detail pages (`/fr-fr/emplois/<id>.html`) are not disallowed.
// Keep volume low, do not use this commercially or for bulk collection, and run
// it on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = {
    q: "query",
    l: "location",
    c: "contract",
    n: "limit",
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

const HELP = `hellowork-cli — search jobs and freelance missions on HelloWork (France)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords: job title, skill, or stack. Recommended.
  --location, -l <text>   Place. Needs HelloWork's own form: "<City> <postcode>"
                          (e.g. "Paris 75000", "Lyon 69000") or a region name
                          (e.g. "Ile-de-France"). A bare city name returns 0 results.
  --contract, -c <types>  Freelance | Independant | CDI | CDD | Travail_temp | Stage |
                          Alternance | Franchise | Associe | Fonctionnaire.
                          Comma-separated for OR. English aliases accepted.
  --jobage <days>         Posted within N days. HelloWork's own buckets are
                          24h / 3d / 1w / 1m; anything finer is filtered client-side.
  --sort <mode>           relevance (default) | date.
  --radius <km>           Search radius around --location. HelloWork default is 20.
  --page <n>              1-indexed page (30 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "backend" -l "Paris 75000" -c Freelance --format table
  bun run src/cli.ts search -q "typescript" -l "Ile-de-France" -c Freelance --jobage 7 --sort date
  bun run src/cli.ts search -q "developpeur node" -c Freelance,Independant -n 10 --format plain
  bun run src/cli.ts search -q "rust" -l "Paris 75000" --radius 30 --page 2
  bun run src/cli.ts detail 81577686 --format plain
  bun run src/cli.ts detail https://www.hellowork.com/fr-fr/emplois/81577686.html

⚠️ Personal use only — HelloWork's robots.txt disallows the search path for
generic clients. Keep volume low; no commercial or bulk use.
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
    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(
          JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) +
            "\n",
        )
        return null
      }
      return val
    }

    for (const name of ["jobage", "page", "limit", "radius"]) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const sortRaw = typeof flags.sort === "string" ? flags.sort.toLowerCase() : "relevance"
    if (!["relevance", "date"].includes(sortRaw)) {
      process.stderr.write(
        JSON.stringify({
          error: `--sort must be "relevance" or "date", got "${sortRaw}"`,
          code: "BAD_ARG",
        }) + "\n",
      )
      return 1
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      contract: typeof flags.contract === "string" ? flags.contract : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      sort: sortRaw as SearchOpts["sort"],
      radius: flags.radius ? parseInt(flags.radius as string, 10) : undefined,
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
        JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n",
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
