import { loadRegistry, matchesFilters, writeError, type NormalizedJob, type RegistryEntry } from "../helpers.js"
import { fetchGreenhouse, fetchLever, fetchSmartRecruiters, fetchOracle, fetchGeneric } from "../ats.js"

export interface SearchOpts {
  company?: string
  query?: string
  location?: string
  limit?: number
  format: "json" | "table" | "plain"
}

async function fetchEntry(entry: RegistryEntry): Promise<NormalizedJob[]> {
  switch (entry.ats) {
    case "greenhouse":
      return fetchGreenhouse(entry)
    case "lever":
      return fetchLever(entry)
    case "smartrecruiters":
      return fetchSmartRecruiters(entry)
    case "oracle":
      return fetchOracle(entry)
    case "generic":
      return fetchGeneric(entry)
    default:
      // A typo'd ats used to fall through to the generic scraper, which returns
      // nothing for a JS portal — so "greenhose" read as "no openings" forever.
      throw new Error(
        `"${entry.name}" declares unknown ats "${entry.ats}" - expected greenhouse, lever, smartrecruiters, oracle or generic [config_error]`,
      )
  }
}

function renderTable(jobs: NormalizedJob[]): string {
  if (jobs.length === 0) return "No results."
  const rows = jobs.map((j) => {
    const company = (j.company || "").slice(0, 22).padEnd(22)
    const title = (j.title || "").slice(0, 42).padEnd(42)
    const loc = (j.location || "—").slice(0, 20).padEnd(20)
    const ats = j.source_ats.padEnd(15)
    return `${company} ${title} ${loc} ${ats}`
  })
  const header =
    "COMPANY".padEnd(22) + " " + "TITLE".padEnd(42) + " " + "LOCATION".padEnd(20) + " ATS"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const registry = await loadRegistry()
    const entries = opts.company
      ? registry.filter((e) => e.name.toLowerCase() === opts.company!.toLowerCase())
      : registry

    if (opts.company && entries.length === 0) {
      writeError(`No registry entry named "${opts.company}"`, "COMPANY_NOT_FOUND")
      return 1
    }

    const results = await Promise.allSettled(entries.map((e) => fetchEntry(e)))
    let jobs: NormalizedJob[] = []
    const errors: { company: string; error: string }[] = []
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        jobs.push(...r.value)
      } else {
        errors.push({ company: entries[i].name, error: r.reason instanceof Error ? r.reason.message : String(r.reason) })
      }
    })

    jobs = jobs.filter((j) => matchesFilters(j, opts.query, opts.location))
    if (opts.limit !== undefined && opts.limit >= 0) jobs = jobs.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(jobs) + "\n")
      if (errors.length) process.stderr.write(JSON.stringify({ warnings: errors }) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        jobs
          .map((j) => `${j.title}\n  ${j.company} · ${j.location || "—"} · ${j.source_ats}\n  ${j.url}`)
          .join("\n\n") + "\n",
      )
      if (errors.length) process.stderr.write(JSON.stringify({ warnings: errors }) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: jobs.length, errors }, results: jobs }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
