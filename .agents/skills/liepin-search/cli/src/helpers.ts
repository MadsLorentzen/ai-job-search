import type { StandardJob } from "../../../../shared/job-schema.js"
import { normalizeEducation, normalizeExperience, normalizeLocation, parseChineseDate, parseChineseSalary } from "../../../../shared/job-normalization.js"

export type OutputFormat = "json" | "table" | "plain"
export interface SearchOptions { query: string; city?: string; page: number; limit?: number; format: OutputFormat }
export interface ParsedUpstreamOutput { records: number; results: StandardJob[] }

export function writeError(error: string, code: string): void { process.stderr.write(JSON.stringify({ error, code }) + "\n") }

export function scalar(record: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = record[name]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return null
}

export function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []
  for (const key of ["jobs", "results", "data", "items", "list"]) {
    const value = payload[key]
    if (Array.isArray(value)) return value.filter(isRecord)
    if (isRecord(value)) {
      for (const nested of ["jobs", "results", "items", "list"]) if (Array.isArray(value[nested])) return value[nested].filter(isRecord)
    }
  }
  return [payload]
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }

export function normalizeRecord(record: Record<string, unknown>): StandardJob | null {
  const id = scalar(record, ["id", "jobId", "job_id", "positionId", "position_id"])
  const title = scalar(record, ["title", "jobName", "job_name", "positionName", "position_name"])
  const company = scalar(record, ["company", "companyName", "company_name", "compName"])
  const locationRaw = scalar(record, ["location", "address", "city", "workAddress"])
  const dateRaw = scalar(record, ["date", "publishTime", "publish_time", "createTime", "createdAt"])
  const url = normalizeJobUrl(scalar(record, ["url", "jobUrl", "job_url", "detailUrl", "detail_url"]))
  if (!id || !title || !url) return null
  const salaryRaw = scalar(record, ["salary", "salaryDesc", "salary_desc", "salaryText"])
  const salary = parseChineseSalary(salaryRaw)
  const normalizedLocation = normalizeLocation(locationRaw)
  return {
    id: id,
    title: title,
    company: company,
    location: normalizedLocation.raw,
    date: parseChineseDate(dateRaw),
    url: url,
    description: scalar(record, ["description", "jobDescription", "job_desc"]), salary: salaryRaw,
    salary_min: salary.min, salary_max: salary.max, salary_months: salary.months, salary_unit: salary.unit,
    experience: normalizeExperience(scalar(record, ["experience", "workExperience", "work_experience"])),
    education: normalizeEducation(scalar(record, ["education", "eduLevel", "edu_level"])),
    employment_type: null, work_mode: null, recruit_count: null, deadline: null,
    portal: "liepin-search", source: "cli", access_mode: "official_cli", raw_id: id,
    fetched_at: new Date().toISOString(),
  }
}

function normalizeJobUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value, "https://www.liepin.com")
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch { return null }
}

export function parseUpstreamResponse(text: string): ParsedUpstreamOutput {
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new Error("official liepin-cli returned non-JSON output") }
  const records = extractRecords(payload)
  return { records: records.length, results: records.map(normalizeRecord).filter((job): job is StandardJob => job !== null) }
}

export function parseUpstreamOutput(text: string): StandardJob[] { return parseUpstreamResponse(text).results }

export function redactSensitive(value: string): string {
  let result = value.replace(/(x-user-token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]").replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
  const token = process.env.LIEPIN_USER_TOKEN?.trim()
  if (token) result = result.split(token).join("[REDACTED]")
  return result
}

export function classifyUpstreamError(value: string): "CLI_UNAVAILABLE" | "AUTH_REQUIRED" | "AUTH_EXPIRED" | "SEARCH_FAILED" {
  if (/executable not found|ENOENT/i.test(value)) return "CLI_UNAVAILABLE"
  if (/401|403|授权失败|token[^\n]*(?:expired|invalid|失效)/i.test(value)) return "AUTH_EXPIRED"
  if (/缺少[^\n]*token|missing[^\n]*token|x-user-token|token[^\n]*required/i.test(value)) return "AUTH_REQUIRED"
  return "SEARCH_FAILED"
}

export function mapSearchArgs(options: SearchOptions): string[] {
  const args = ["job", "search", "--job-name", options.query, "--page", String(Math.max(0, options.page - 1)), "--output", "json"]
  if (options.city) args.push("--address", options.city)
  return args
}

export function formatResults(results: StandardJob[], page: number, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ meta: { count: results.length, page }, results }, null, 2) + "\n"
  if (format === "table") return ["ID | 职位 | 公司 | 地点 | 薪资", ...results.map((job) => `${job.id} | ${job.title} | ${job.company ?? "-"} | ${job.location ?? "-"} | ${job.salary ?? "-"}`)].join("\n") + "\n"
  return results.map((job) => `${job.title}\n  ${job.company ?? "-"} · ${job.location ?? "-"}\n  ${job.url}`).join("\n\n") + "\n"
}
