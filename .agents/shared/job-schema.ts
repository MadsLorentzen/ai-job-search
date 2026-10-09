export type AccessMode =
  | "public_html"
  | "public_json"
  | "official_cli"
  | "official_api"
  | "browser_assisted"
  | "manual_import"

export interface NormalizedSalary {
  raw: string | null
  min: number | null
  max: number | null
  unit: "month" | "year" | "day" | "hour" | "unknown"
  months: number | null
}

export interface NormalizedLocation {
  raw: string | null
  province: string | null
  city: string | null
  district: string | null
}

export interface StandardJob {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  description: string | null
  salary: string | null
  salary_min: number | null
  salary_max: number | null
  salary_months: number | null
  salary_unit: NormalizedSalary["unit"]
  experience: string | null
  education: string | null
  employment_type: string | null
  work_mode: string | null
  recruit_count: number | null
  deadline: string | null
  portal: string
  source: "cli" | "websearch" | "manual" | "browser"
  access_mode: AccessMode
  raw_id: string | null
  fetched_at: string
}

export function validateStandardJob(job: Partial<StandardJob>): string[] {
  const errors: string[] = []
  for (const field of ["id", "title", "url", "portal", "fetched_at"] as const) {
    if (typeof job[field] !== "string" || job[field].trim() === "") {
      errors.push(field + " is required")
    }
  }
  if (job.company !== undefined && job.company !== null && typeof job.company !== "string") {
    errors.push("company must be a string or null")
  }
  if (job.date !== undefined && job.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(job.date)) {
    errors.push("date must be YYYY-MM-DD or null")
  }
  if (job.deadline !== undefined && job.deadline !== null && !/^\d{4}-\d{2}-\d{2}$/.test(job.deadline)) {
    errors.push("deadline must be YYYY-MM-DD or null")
  }
  return errors
}
