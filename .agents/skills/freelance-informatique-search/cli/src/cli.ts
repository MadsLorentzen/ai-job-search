#!/usr/bin/env bun
// Self-contained CLI for searching freelance IT missions on freelance-informatique.fr,
// the long-running French IT contracting board. No external CLI framework, so it runs
// anywhere `bun` is available with zero install beyond the repo clone.
//
// The portal's robots.txt permits /offres-freelance and /mission-*; this CLI touches
// nothing else. Still a personal job-search tool — keep request volume modest.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
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

const HELP = `freelance-informatique-cli — search freelance IT missions in France

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <ref|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Skill or technology, matched against the portal's skills
                          taxonomy (e.g. "Java", "Node.js", "Kubernetes"). Not a
                          free-text search — see the Notes in SKILL.md.
  --location, -l <place>  CLIENT-SIDE filter on the mission's "75 - Paris" field.
                          Accepts a department number ("75"), a city ("Bordeaux"),
                          "idf" / "ile-de-france", or "remote" / "teletravail".
  --jobage <days>         Posted within N days. CLIENT-SIDE — no portal parameter.
  --page <n>              1-indexed page, 50 missions per page. Default 1.
  --limit, -n <n>         Cap results emitted (client-side, applied last).
  --strict                Keep only missions actually tagged with --query. The portal
                          answers an unknown term with related-skill missions instead
                          of nothing (\`-q Rust\` returns C++ missions), so use this
                          whenever a term may be outside its taxonomy.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "Node.js" --format table
  bun run src/cli.ts search -q "Java" -l idf --jobage 7 --format table
  bun run src/cli.ts search -q "Kubernetes" -l remote --format plain
  bun run src/cli.ts search -q "PostgreSQL" -l 92 -n 10
  bun run src/cli.ts search --page 2 --format table
  bun run src/cli.ts detail 260728C015 --format plain

NOTES
  This portal never publishes a TJM, and clients are anonymised — \`dailyRate\` and
  \`company\` are always null. Use free-work-search when you need a daily rate.
`

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = parseInt(raw as string, 10)
  if (isNaN(val)) {
    process.stderr.write(
      JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n",
    )
    return null
  }
  return val
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      strict: flags.strict === true || flags.strict === "true",
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires a <ref|url>", code: "NO_ID" }) + "\n",
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
