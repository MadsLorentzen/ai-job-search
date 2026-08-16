import {
  ALGOLIA_URL,
  JOBS_INDEX,
  REST_BASE,
  jsonGet,
  jsonPost,
  parseDetail,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

interface Ref {
  orgSlug: string
  jobSlug: string
}

/** Extract org + job slug from a full Welcome to the Jungle job URL. */
function refFromUrl(input: string): Ref | null {
  const m = input.match(/\/companies\/([^/?#]+)\/jobs\/([^/?#]+)/)
  return m ? { orgSlug: m[1], jobSlug: m[2] } : null
}

/** Resolve an Algolia objectID or a bare job slug to an org+job slug pair. */
async function resolveRef(id: string): Promise<Ref | null> {
  const isNumeric = /^\d+$/.test(id)
  const filter = isNumeric ? `objectID:${id}` : `slug:${id}`
  const params = new URLSearchParams()
  params.set("query", "")
  params.set("hitsPerPage", "1")
  params.set("filters", filter)
  const data = await jsonPost(ALGOLIA_URL, {
    requests: [{ indexName: JOBS_INDEX, params: params.toString() }],
  })
  const hit = data?.results?.[0]?.hits?.[0]
  if (!hit || !hit.slug || !hit.organization?.slug) return null
  return { orgSlug: hit.organization.slug, jobSlug: hit.slug }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    let ref = refFromUrl(opts.id)
    if (!ref && opts.id.includes("/") && !opts.id.startsWith("http")) {
      const [orgSlug, jobSlug] = opts.id.split("/")
      if (orgSlug && jobSlug) ref = { orgSlug, jobSlug }
    }
    if (!ref) ref = await resolveRef(opts.id)
    if (!ref) {
      writeError(`Could not resolve a job from "${opts.id}"`, "NOT_FOUND")
      return 1
    }

    const payload = await jsonGet(
      `${REST_BASE}/organizations/${ref.orgSlug}/jobs/${ref.jobSlug}`,
    )
    if (!payload) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseDetail(payload, opts.id)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.remote ? `Remote: ${job.remote}` : "",
        job.contractType ? `Contract: ${job.contractType}` : "",
        job.seniority ? `Experience: ${job.seniority}` : "",
        job.educationLevel ? `Education: ${job.educationLevel}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.date ? `Posted: ${job.date}` : "",
        "",
        job.description || "(no description)",
        job.profile ? "\nPreferred experience:\n" + job.profile : "",
        "",
        `URL: ${job.url}`,
        job.applyUrl ? `Apply: ${job.applyUrl}` : "",
      ].filter((l) => l !== "")
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
