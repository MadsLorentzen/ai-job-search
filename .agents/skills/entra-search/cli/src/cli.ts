#!/usr/bin/env bun
// Self-contained CLI for searching ENTRA's public JSON API (entracareers.com).
// No external CLI framework and zero runtime dependencies, so it runs anywhere
// `bun` is available with nothing installed beyond the repo clone.
//
// Hosted-service dependency: reads are public (no API key) and hit
// entracareers.com. Point ENTRA_API_URL at a staging or self-hosted instance to
// swap the source.

import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  MAX_LIMIT,
  SORTS,
  WORK_MODES,
  runSearch,
  type EmploymentType,
  type ExperienceLevel,
  type SearchOpts,
  type Sort,
  type WorkMode,
} from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { baseUrl } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

// Short-flag aliases.
const ALIAS: Record<string, string> = { q: "query", n: "limit", l: "location" }

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      ;(flags._ as string[]).push(a)
      continue
    }
    const name = a.replace(/^-+/, "")
    const key = ALIAS[name] ?? name
    const next = argv[i + 1]
    // A flag with no following value (or another flag next) is a boolean.
    let value: string | boolean = true
    if (next !== undefined && !next.startsWith("-")) {
      value = next
      i++
    }
    flags[key] = value
  }
  return flags
}

type FlagValue = string | boolean | string[] | undefined

/**
 * A flag's string value. A bare flag (set without a value, i.e. `true`) yields
 * `whenBare` — e.g. `--remote` alone means work mode "remote".
 */
function stringFlag(raw: FlagValue, whenBare?: string): string | undefined {
  if (typeof raw === "string") return raw
  if (raw === true) return whenBare
  return undefined
}

/** Split a comma-separated value ("a,b") into a trimmed list. */
function commaList(raw: FlagValue): string[] {
  if (typeof raw !== "string") return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

const HELP = `entra-cli — search ENTRA (entracareers.com): verified AI & tech jobs from company hiring systems, many countries

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [filters] [--format json|table|plain]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>       Keywords (title, skills, company). Full-text; optional.
  --location, -l <text>    Client-side filter on "City, Country" (substring, case-insensitive),
                           e.g. -l "Berlin", -l "United States". Combine with --remote for remote roles.
  --remote [mode]          remote (bare flag) | hybrid | office. \`onsite\` is accepted as an alias of office.
  --experience <level>     ${EXPERIENCE_LEVELS.join(" | ")}
  --employment <type>      ${EMPLOYMENT_TYPES.join(" | ")}
  --specialization <slugs> ENTRA specialization slug(s), comma = OR (see /api/specializations).
  --company <slug|name>    One company, resolved via the public /companies search (e.g. stripe, spacex).
  --salary-min <n>         Only postings whose stated minimum salary is at least n (postings without a salary are excluded).
  --jobage <days>          Posted within N days (applied client-side; results arrive newest-first).
  --sort <key>             date (default) | salary.
  --page <n>               1-indexed page. Default 1.
  --limit, -n <n>          Results per page, 1–${MAX_LIMIT}. Default 25.
  --no-description         Drop description bodies for a cheap discovery pass (fetch one with detail).
  --format <fmt>           json (default) | table | plain.

DETAIL
  <id|url>                 An ENTRA job id (UUID, from a search result's id) or a full
                           https://entracareers.com/<cc>/vacancies/<uuid> URL.

EXAMPLES
  bun run src/cli.ts search -q "machine learning engineer" --remote --limit 10 --format table
  bun run src/cli.ts search -q "product manager" -l "United States" --experience 3_6_years --format table
  bun run src/cli.ts search --company spacex --jobage 14 --sort salary --format table
  bun run src/cli.ts search -q "data engineer" --specialization data-engineer --employment full_time
  bun run src/cli.ts detail 25b71e5a-db28-43a2-84c0-1c7df875a547 --format plain

Reads are public (no API key). Source: ${baseUrl()} — override with ENTRA_API_URL.
`

function parseIntFlag(name: string, raw: FlagValue, min: number, max?: number): number | null {
  // Number(), not parseInt(): parseInt truncates "1.5" to 1 and "0.5" to 0,
  // which would silently change a filter while exiting 0. Whole numbers only.
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < min || (max !== undefined && val > max)) {
    const range = max !== undefined ? `between ${min} and ${max}` : `at least ${min}`
    process.stderr.write(JSON.stringify({ error: `--${name} must be a whole number ${range}, got "${raw}"`, code: "BAD_ARG" }) + "\n")
    return null
  }
  return val
}

function enumFlag<T extends string>(name: string, raw: string | undefined, allowed: readonly T[]): T | null | undefined {
  if (raw === undefined) return undefined
  if ((allowed as readonly string[]).includes(raw)) return raw as T
  process.stderr.write(JSON.stringify({ error: `--${name} must be one of ${allowed.join("|")}, got "${raw}"`, code: "BAD_ARG" }) + "\n")
  return null
}

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/n/l to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "remote", "experience", "employment", "specialization", "company", "salary-min",
    "jobage", "sort", "page", "limit", "no-description", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error. add-portal.md's
  // contract requires a bogus flag to exit 1 with a JSON error on stderr.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const fmt = enumFlag("format", stringFlag(flags.format), ["json", "table", "plain"] as const)
    if (fmt === null) return 1

    const jobage = flags.jobage !== undefined ? parseIntFlag("jobage", flags.jobage, 1) : 9999
    if (jobage === null) return 1
    const page = flags.page !== undefined ? parseIntFlag("page", flags.page, 1) : 1
    if (page === null) return 1
    const limit = flags.limit !== undefined ? parseIntFlag("limit", flags.limit, 1, MAX_LIMIT) : 25
    if (limit === null) return 1
    const salaryMin = flags["salary-min"] !== undefined ? parseIntFlag("salary-min", flags["salary-min"], 0) : undefined
    if (salaryMin === null) return 1

    // --remote <mode> takes the given work mode; a bare --remote means "remote".
    let remoteRaw = stringFlag(flags.remote, "remote")
    if (remoteRaw === "onsite") remoteRaw = "office"
    const workMode = enumFlag<WorkMode>("remote", remoteRaw, WORK_MODES)
    if (workMode === null) return 1
    const experience = enumFlag<ExperienceLevel>("experience", stringFlag(flags.experience), EXPERIENCE_LEVELS)
    if (experience === null) return 1
    const employment = enumFlag<EmploymentType>("employment", stringFlag(flags.employment), EMPLOYMENT_TYPES)
    if (employment === null) return 1
    const sort = enumFlag<Sort>("sort", stringFlag(flags.sort), SORTS)
    if (sort === null) return 1

    const opts: SearchOpts = {
      query: stringFlag(flags.query),
      location: stringFlag(flags.location),
      jobage,
      page,
      limit,
      format: fmt ?? "json",
      includeDescription: flags["no-description"] === undefined,
      workMode,
      experience,
      employment,
      specializations: commaList(flags.specialization),
      company: stringFlag(flags.company),
      salaryMin,
      sort: sort ?? "date",
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = enumFlag("format", stringFlag(flags.format), ["json", "plain"] as const)
    if (fmt === null) return 1
    const opts: DetailOpts = { id, format: fmt ?? "json" }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n")
    process.exit(1)
  })
