import {
  BASE_URL,
  cityIdForLocation,
  htmlFetch,
  parseSearchPage,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function buildUrl(opts: SearchOpts): string {
  const query = opts.query?.trim()
  const slug = query
    ? encodeURIComponent(query.replace(/\s+/g, "-"))
    : "all"
  let url = `${BASE_URL}/job/jsearch/q/${slug}`
  if (opts.location) {
    const cityId = cityIdForLocation(opts.location)
    if (!cityId) {
      throw new Error(`Unsupported Rozee city "${opts.location}". Omit --location for all Pakistan or use Lahore, Karachi, Islamabad, Rawalpindi, or Faisalabad.`)
    }
    url += `/fc/${cityId}`
  }
  if (opts.page > 1) {
    const offset = (opts.page - 1) * 20
    url += `/?fpn=${offset}`
  }
  return url
}

function renderTable(jobs: JobCard[]): string {
  if (jobs.length === 0) return "No results."
  const rows = jobs.map((job) => {
    const title = job.title.slice(0, 42).padEnd(42)
    const company = (job.company ?? "—").slice(0, 26).padEnd(26)
    const location = (job.location ?? "—").slice(0, 20).padEnd(20)
    const date = job.date ?? "—"
    return `${job.id.padEnd(48)} ${title} ${company} ${location} ${date}`
  })
  const header =
    "ID".padEnd(48) +
    " " +
    "TITLE".padEnd(42) +
    " " +
    "COMPANY".padEnd(26) +
    " " +
    "LOCATION".padEnd(20) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    const parsed = parseSearchPage(html)
    if (parsed.jobs.length === 0 && (parsed.total ?? 0) > 0) {
      throw new Error(`Rozee reported ${parsed.total} matching jobs, but none could be parsed from the results page`)
    }
    if (parsed.malformedRecords > 0) {
      process.stderr.write(
        JSON.stringify({
          warning: `Skipped ${parsed.malformedRecords} malformed or incomplete Rozee result record(s)`,
          code: "PARTIAL_PARSE",
        }) + "\n",
      )
    }
    const jobs =
      opts.limit === undefined ? parsed.jobs : parsed.jobs.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(jobs) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        jobs
          .map(
            (job) =>
              `${job.title}\n  ${job.company ?? "—"} · ${job.location ?? "—"} · ${job.date ?? "—"}\n  id: ${job.id}\n  ${job.url}`,
          )
          .join("\n\n") + (jobs.length > 0 ? "\n" : ""),
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: jobs.length,
              total: parsed.total,
              page: opts.page,
              pageSize: 20,
            },
            results: jobs,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error), "SEARCH_FAILED")
    return 1
  }
}
