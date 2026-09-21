import { apiGet, normalizeId, toDetail, writeError, type EntraJob, type ItemEnvelope, type JobDetailResult } from "../helpers.js"

export interface DetailOpts {
  id: string // an ENTRA job UUID or a .../vacancies/<uuid> URL
  format: "json" | "plain"
}

/** A human-readable rendering of one job: header, present fields, description. */
function renderPlain(job: JobDetailResult): string {
  const lines = [job.title, `${job.company ?? "—"} · ${job.location ?? "—"}`]
  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Posted", job.date && job.date.slice(0, 10))
  field("Expires", job.expires_at && job.expires_at.slice(0, 10))
  field("Work mode", job.work_mode)
  field("Experience", job.experience)
  field("Employment", job.employment_type)
  field("Specialization", job.specialization)
  field("Salary", job.salary)
  field("Source ATS", job.source)
  if (job.is_active === false) lines.push("Status: no longer active on ENTRA")
  lines.push("", job.description ?? "(no description)")
  if (job.requirements) lines.push("", "Requirements:", job.requirements)
  lines.push("", `URL: ${job.url}`)
  if (job.apply_url) lines.push(`Apply: ${job.apply_url}`)
  lines.push(`id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`could not parse an ENTRA job id from "${opts.id}" (expected a UUID or an entracareers.com/.../vacancies/<uuid> URL)`, "BAD_ID")
    return 1
  }
  try {
    const env = await apiGet<ItemEnvelope<EntraJob>>(`/jobs/${encodeURIComponent(id)}`)
    if (!env || !env.data) {
      writeError("job not found", "NOT_FOUND")
      return 1
    }
    const job = toDetail(env.data)
    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job) + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
