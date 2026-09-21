import {
  apiGet,
  toResult,
  writeError,
  type EntraCompany,
  type EntraJob,
  type JobResult,
  type ListEnvelope,
} from "../helpers.js"

export const WORK_MODES = ["remote", "hybrid", "office"] as const
export type WorkMode = (typeof WORK_MODES)[number]

export const EXPERIENCE_LEVELS = ["no_experience", "1_3_years", "3_6_years", "6_plus_years"] as const
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "freelance", "internship"] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]

export const SORTS = ["date", "salary"] as const
export type Sort = (typeof SORTS)[number]

/** The API's hard page-size ceiling (`limit` maximum 100). */
export const MAX_LIMIT = 100

export interface SearchOpts {
  query?: string
  // Client-side substring filter on the "City, Country" location (the API has
  // no free-text location parameter; geography is UUID-keyed server-side).
  location?: string
  jobage: number
  page: number
  limit: number
  format: "json" | "table" | "plain"
  // Keep each result's full description (the API's list endpoint already
  // carries it, so search never needs a per-hit `detail`). False strips the
  // bodies client-side for a cheap discovery pass.
  includeDescription?: boolean
  workMode?: WorkMode
  experience?: ExperienceLevel
  employment?: EmploymentType
  specializations: string[]
  company?: string // company slug or name; resolved to companyId via /companies
  salaryMin?: number
  sort: Sort
}

export function buildQuery(opts: SearchOpts, companyId?: string): URLSearchParams {
  const p = new URLSearchParams()
  if (opts.query) p.set("search", opts.query)
  if (opts.workMode) p.set("workLocation", opts.workMode)
  if (opts.experience) p.set("experienceLevel", opts.experience)
  if (opts.employment) p.set("employmentType", opts.employment)
  for (const slug of opts.specializations) p.append("specializationSlugs", slug)
  if (companyId) p.set("companyId", companyId)
  if (opts.salaryMin != null) p.set("salaryMin", String(opts.salaryMin))
  p.set("sortBy", opts.sort === "salary" ? "salary" : "publishedAt")
  p.set("sortOrder", "desc")
  p.set("page", String(opts.page))
  p.set("limit", String(opts.limit))
  return p
}

/** Resolve a company slug or name to its id via the public /companies search. */
async function resolveCompanyId(companyRef: string): Promise<string | null> {
  const q = new URLSearchParams({ search: companyRef, limit: "10", page: "1" })
  const env = await apiGet<ListEnvelope<EntraCompany>>(`/companies?${q.toString()}`)
  const rows = env?.data ?? []
  const wanted = companyRef.trim().toLowerCase()
  const exact = rows.find((c) => c.slug?.toLowerCase() === wanted || c.name?.trim().toLowerCase() === wanted)
  return (exact ?? rows[0])?.id ?? null
}

/** The date portion (YYYY-MM-DD) of an ISO timestamp, or "—" when absent. */
function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
}

/** Posted within the last N days (undated results are kept: absent ≠ old). */
export function withinDays(date: string | null, days: number, now: number = Date.now()): boolean {
  if (!date) return true
  const t = Date.parse(date)
  if (Number.isNaN(t)) return true
  return now - t <= days * 86_400_000
}

/** Case-insensitive substring match on the location; null locations never match a filter. */
export function matchesLocation(location: string | null, wanted: string): boolean {
  if (!location) return false
  return location.toLowerCase().includes(wanted.trim().toLowerCase())
}

interface Column {
  header: string
  width: number
  cell: (r: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  // The ID column is sized to the longest id so it is never truncated — a cut
  // id can't be looked up in `detail`; the fixed-width columns truncate for scanning.
  const columns: Column[] = [
    { header: "ID", width: Math.max(2, ...rows.map((r) => r.id.length)), cell: (r) => r.id },
    { header: "TITLE", width: 38, cell: (r) => r.title },
    { header: "COMPANY", width: 22, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 24, cell: (r) => r.location ?? "—" },
    { header: "MODE", width: 7, cell: (r) => r.work_mode ?? "—" },
    { header: "DATE", width: 10, cell: (r) => shortDate(r.date) },
  ]
  const row = (cells: string[]) => cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")
  const header = row(columns.map((c) => c.header))
  const body = rows.map((r) => row(columns.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const block = (r: JobResult) =>
    [
      r.title,
      `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${r.work_mode ?? "—"} · ${shortDate(r.date)}${r.salary ? ` · ${r.salary}` : ""}`,
      `  id: ${r.id}`,
      `  ${r.url}`,
    ].join("\n")
  return rows.map(block).join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    let companyId: string | undefined
    if (opts.company) {
      const id = await resolveCompanyId(opts.company)
      if (!id) {
        writeError(`no ENTRA company matches "${opts.company}" — check the slug at ${"https://entracareers.com/companies"}`, "NOT_FOUND")
        return 1
      }
      companyId = id
    }

    const env = await apiGet<ListEnvelope<EntraJob>>(`/jobs?${buildQuery(opts, companyId).toString()}`)
    if (!env) {
      writeError("/jobs not found — check ENTRA_API_URL (it must point at the API root, e.g. https://entracareers.com/api)", "SEARCH_FAILED")
      return 1
    }

    let rows = (env.data ?? []).map(toResult)
    // The API has no recency parameter; results arrive newest-first, so the
    // freshness window is applied client-side on the publication date.
    if (opts.jobage > 0 && opts.jobage < 9999) rows = rows.filter((r) => withinDays(r.date, opts.jobage))
    // Geography is UUID-keyed server-side (no free-text parameter); match the
    // rendered "City, Country" instead.
    if (opts.location) rows = rows.filter((r) => matchesLocation(r.location, opts.location!))
    if (opts.includeDescription === false) rows = rows.map((r) => ({ ...r, description: null }))

    const total = typeof env.total === "number" ? env.total : rows.length
    const totalPages = typeof env.totalPages === "number" ? env.totalPages : null

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: rows.length, page: opts.page, total, total_pages: totalPages }, results: rows }, null, 2) +
          "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
