import { apiFetch, mapJob, writeError, type JobResult, type SearchResponse } from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  radius?: number
  jobage?: number
  worktime?: string
  contract?: string
  offertype?: string
  employer?: string
  noTempwork?: boolean
  page: number
  size: number
  limit?: number
  format: "json" | "table" | "plain"
}

function buildParams(opts: SearchOpts): Record<string, string> {
  const params: Record<string, string> = {
    page: String(opts.page),
    size: String(opts.size),
  }
  if (opts.query) params.was = opts.query
  if (opts.location) params.wo = opts.location
  if (opts.radius !== undefined) params.umkreis = String(opts.radius)
  if (opts.jobage !== undefined) params.veroeffentlichtseit = String(opts.jobage)
  if (opts.worktime) params.arbeitszeit = opts.worktime
  if (opts.contract) params.befristung = opts.contract
  if (opts.offertype) params.angebotsart = opts.offertype
  if (opts.employer) params.arbeitgeber = opts.employer
  if (opts.noTempwork) params.zeitarbeit = "false"
  return params
}

function renderTable(jobs: JobResult[], total: number): string {
  if (jobs.length === 0) return "No results."
  const header =
    "ID".padEnd(22) + " " + "TITLE".padEnd(46) + " " + "COMPANY".padEnd(28) + " " + "LOCATION".padEnd(22) + " DATE"
  const rows = jobs.map((j) => {
    const id = j.id.slice(0, 22).padEnd(22)
    const title = j.title.slice(0, 46).padEnd(46)
    const company = (j.company || "—").slice(0, 28).padEnd(28)
    const loc = (j.location || "—").slice(0, 22).padEnd(22)
    return `${id} ${title} ${company} ${loc} ${j.date || "—"}`
  })
  return [header, "-".repeat(header.length), ...rows, "", `Total matches: ${total}`].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const data = await apiFetch<SearchResponse>("/pc/v4/jobs", buildParams(opts))
    let jobs = (data.stellenangebote ?? []).map(mapJob)
    if (opts.limit !== undefined && opts.limit >= 0) jobs = jobs.slice(0, opts.limit)
    const total = data.maxErgebnisse ?? jobs.length

    if (opts.format === "table") {
      process.stdout.write(renderTable(jobs, total) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        jobs
          .map(
            (j) =>
              `${j.title}\n  ${j.company || "—"} · ${j.location || "—"} · ${j.date || "—"}\n  id: ${j.id}\n  ${j.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: total, page: opts.page }, results: jobs }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
