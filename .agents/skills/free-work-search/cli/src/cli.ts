#!/usr/bin/env bun
// Self-contained CLI for searching IT / tech job postings and freelance
// missions on Free-Work (www.free-work.com, the French market), backed by the
// site's public JSON API. No external CLI framework and no runtime
// dependencies, so it runs anywhere `bun` is available.
//
// Free-Work's robots.txt permits the job paths (only /login, /logout and
// /fw-deals are disallowed), and the API answers unauthenticated requests.
// Still, keep request volume modest — this is a personal job-search tool.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CONTRACT_VALUES, REMOTE_VALUES } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", c: "contract" }
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

const HELP = `free-work-cli — search IT jobs and freelance missions on Free-Work (France)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, stack). Recommended.
  --location, -l <place>  Region, department or city. Accepts a friendly name
                          ("Ile-de-France", "Paris") or an exact Free-Work
                          location key ("fr~ile-de-france~~").
  --contract, -c <types>  ${CONTRACT_VALUES.join(" | ")}
                          Comma-separated for OR. Use "contractor" for freelance.
  --remote <mode>         ${REMOTE_VALUES.join(" | ")} (client-side filter)
  --jobage <days>         Posted within N days (client-side; API has no date filter).
  --page <n>              1-indexed page, 50 results/page. Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "backend" -c contractor -l "Ile-de-France" --format table
  bun run src/cli.ts search -q "rust" -c contractor --jobage 14 --format plain
  bun run src/cli.ts search -q "developpeur typescript" -c contractor -l Paris -n 10
  bun run src/cli.ts search -q "platform engineer" -c contractor --remote full --format table
  bun run src/cli.ts detail developpeur-back-end-nodejs-h-f --format plain

NOTES
  Postings are keyed by slug, not numeric id — pass the "slug" from a search
  result (or the full posting URL) to \`detail\`.
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
    const fmt = (flags.format as string) || "json"

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        writeErr(`--${name} must be a number, got "${raw}"`, "BAD_ARG")
        return null
      }
      return val
    }

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    let contract: string | undefined
    if (typeof flags.contract === "string") {
      const values = flags.contract.split(",").map((v) => v.trim()).filter(Boolean)
      const bad = values.filter((v) => !(CONTRACT_VALUES as readonly string[]).includes(v))
      if (bad.length) {
        writeErr(
          `--contract got unknown value(s) ${bad.map((b) => `"${b}"`).join(", ")}; ` +
            `valid: ${CONTRACT_VALUES.join(", ")}`,
          "BAD_ARG",
        )
        return 1
      }
      contract = values.join(",")
    }

    let remote: string | undefined
    if (typeof flags.remote === "string") {
      if (!(REMOTE_VALUES as readonly string[]).includes(flags.remote)) {
        writeErr(
          `--remote got "${flags.remote}"; valid: ${REMOTE_VALUES.join(", ")}`,
          "BAD_ARG",
        )
        return 1
      }
      remote = flags.remote
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      contract,
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
      writeErr("detail requires a <slug|url>", "NO_ID")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = { id, format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"] }
    return runDetail(opts)
  }

  writeErr(`Unknown command "${cmd}"`, "BAD_CMD")
  return 1
}

function writeErr(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeErr(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
