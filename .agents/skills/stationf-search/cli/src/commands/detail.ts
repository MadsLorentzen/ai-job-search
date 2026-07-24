import {
  cleanHtml,
  contractFromLd,
  jobUrl,
  locationFromLd,
  normalizeId,
  parseJobPosting,
  salaryFromLd,
  textFetch,
  writeError,
  type JobDetailResult,
  type LdJobPosting,
} from "../helpers.js"

export interface DetailOpts {
  id: string // "<org-slug>/<job-slug>" or a full board job URL
  format: "json" | "plain"
}

/**
 * Build the detail result from the job page's schema.org JobPosting. Fields the
 * page does not publish (remote policy, department) stay null rather than being
 * guessed — `search` is where those come from.
 */
export function toDetail(ld: LdJobPosting, org: string, slug: string): JobDetailResult {
  const contract = contractFromLd(ld.employmentType)
  return {
    id: `${org}/${slug}`,
    title: ld.title || "(sans titre)",
    company: ld.hiringOrganization?.name || null,
    location: locationFromLd(ld),
    date: ld.datePosted ?? null,
    url: jobUrl(org, slug),
    contract: contract.label,
    contract_type: contract.code,
    remote: null,
    salary: salaryFromLd(ld.baseSalary),
    department: null,
    experience_years: null,
    reference: null,
    description: cleanHtml(ld.description),
    qualifications: cleanHtml(ld.qualifications),
    education: cleanHtml(ld.educationRequirements),
    experience: cleanHtml(ld.experienceRequirements),
    valid_through: ld.validThrough ?? null,
  }
}

function renderPlain(job: JobDetailResult): string {
  const lines: string[] = [job.title, `${job.company ?? "—"} · ${job.location ?? "—"}`]
  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Contrat", job.contract)
  field("Publié le", job.date && job.date.slice(0, 10))
  field("Valable jusqu'au", job.valid_through && job.valid_through.slice(0, 10))
  field("Salaire", job.salary)
  field("Formation", job.education)
  field("Expérience", job.experience)

  lines.push("", job.description ?? "(pas de description)")
  if (job.qualifications) lines.push("", "Profil recherché:", job.qualifications)
  lines.push("", `URL: ${job.url}`, `id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const parsed = normalizeId(opts.id)
  if (!parsed) {
    writeError(
      `could not parse a job id from "${opts.id}" — expected "<org-slug>/<job-slug>" or a jobs.stationf.co job URL`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const html = await textFetch(jobUrl(parsed.org, parsed.slug))
    if (!html) {
      writeError("job not found", "NOT_FOUND")
      return 1
    }
    const ld = parseJobPosting(html)
    if (!ld) {
      writeError(
        "no JobPosting data found on the job page (the board's markup may have changed — see url-reference.md)",
        "PARSE_FAILED",
      )
      return 1
    }
    const job = toDetail(ld, parsed.org, parsed.slug)

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
