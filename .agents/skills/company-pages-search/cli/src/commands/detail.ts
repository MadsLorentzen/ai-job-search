import { loadRegistry, writeError } from "../helpers.js"
import { fetchGreenhouseDetail, fetchLeverDetail, fetchSmartRecruitersDetail, fetchOracleDetail } from "../ats.js"

export interface DetailOpts {
  company: string
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    const registry = await loadRegistry()
    const entry = registry.find((e) => e.name.toLowerCase() === opts.company.toLowerCase())
    if (!entry) {
      writeError(`No registry entry named "${opts.company}"`, "COMPANY_NOT_FOUND")
      return 1
    }
    if (entry.ats === "generic") {
      writeError(
        `"${entry.name}" is ats=generic — there is no detail API. WebFetch the job URL directly.`,
        "NO_DETAIL_API",
      )
      return 1
    }

    let job: Record<string, unknown> | null = null
    if (entry.ats === "greenhouse") job = await fetchGreenhouseDetail(entry.ats_id, opts.id)
    else if (entry.ats === "lever") job = await fetchLeverDetail(entry.ats_id, opts.id)
    else if (entry.ats === "smartrecruiters") job = await fetchSmartRecruitersDetail(entry.ats_id, opts.id)
    else if (entry.ats === "oracle") job = await fetchOracleDetail(entry.ats_id, opts.id)

    if (!job) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    job.company = entry.name

    if (opts.format === "plain") {
      const lines = [
        String(job.title ?? "(untitled)"),
        `${entry.name} · ${job.location ?? "—"}`,
        "",
        String(job.description ?? "(no description)"),
        "",
        `URL: ${job.url ?? "—"}`,
      ]
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
