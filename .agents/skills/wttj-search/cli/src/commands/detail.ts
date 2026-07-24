import {
  cleanHtml,
  contractFromLd,
  fetchRecordBySlug,
  jobUrl,
  locationFromLd,
  normalizeId,
  parseJobPosting,
  salaryFromLd,
  textFetch,
  toResult,
  WafChallengeError,
  writeError,
  type JobDetailResult,
  type LdJobPosting,
  type WkHit,
} from "../helpers.js"

export interface DetailOpts {
  id: string // "<org-slug>/<job-slug>" or a full welcometothejungle.com job URL
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
    source: "page",
  }
}

/**
 * Build the detail result from a search-index record — the fallback when the WAF
 * blocks the job page. The index has every structured field and the requirements
 * text, but no full description, so `description` is honestly null.
 */
export function toDetailFromRecord(hit: WkHit, org: string, slug: string): JobDetailResult | null {
  const base = toResult(hit)
  if (!base) return null
  return {
    ...base,
    id: `${org}/${slug}`,
    description: null,
    qualifications: cleanHtml(hit.profile),
    education: hit.education_level ?? null,
    experience:
      hit.experience_level_minimum != null ? `> ${hit.experience_level_minimum} ans` : null,
    valid_through: null,
    source: "index",
  }
}

function renderPlain(job: JobDetailResult): string {
  const lines: string[] = [job.title, `${job.company ?? "—"} · ${job.location ?? "—"}`]
  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Contrat", job.contract)
  field("Télétravail", job.remote)
  field("Publié le", job.date && job.date.slice(0, 10))
  field("Valable jusqu'au", job.valid_through && job.valid_through.slice(0, 10))
  field("Salaire", job.salary)
  field("Formation", job.education)
  field("Expérience", job.experience)

  if (job.source === "index") {
    lines.push(
      "",
      "[Le contenu vient de l'index de recherche : la page de l'offre était bloquée " +
        "par le pare-feu applicatif. Description complète indisponible.]",
    )
  }
  lines.push("", job.description ?? "(pas de description)")
  if (job.qualifications) lines.push("", "Profil recherché:", job.qualifications)
  lines.push("", `URL: ${job.url}`, `id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const parsed = normalizeId(opts.id)
  if (!parsed) {
    writeError(
      `could not parse a job id from "${opts.id}" — expected "<org-slug>/<job-slug>" or a welcometothejungle.com job URL`,
      "BAD_ID",
    )
    return 1
  }
  const { org, slug } = parsed
  try {
    let job: JobDetailResult | null = null
    try {
      const html = await textFetch(jobUrl(org, slug), { browser: true })
      if (!html) {
        writeError("job not found", "NOT_FOUND")
        return 1
      }
      const ld = parseJobPosting(html)
      if (!ld) {
        writeError(
          "no JobPosting data found on the job page (the markup may have changed — see url-reference.md)",
          "PARSE_FAILED",
        )
        return 1
      }
      job = toDetail(ld, org, slug)
    } catch (e) {
      // The WAF blocks pages, not the search index — degrade to the record
      // rather than failing the caller outright. Any other error propagates.
      if (!(e instanceof WafChallengeError)) throw e
      const hit = await fetchRecordBySlug(org, slug)
      if (!hit) throw e
      job = toDetailFromRecord(hit, org, slug)
      if (!job) throw e
    }

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job) + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    const code = e instanceof WafChallengeError ? e.code : "DETAIL_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
