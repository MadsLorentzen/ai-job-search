import { RESOLVE_API, ORG_JOB_API, getJson, toDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string // a reference, "org/slug", or a WTTJ .../companies/{org}/jobs/{slug} URL
  format: "json" | "plain"
}

/** Work out the org slug + job slug to hit the detail API. */
async function resolve(input: string): Promise<{ org: string; slug: string } | null> {
  // Full "companies/{org}/jobs/{slug}" URL — org and slug are both present.
  const urlMatch = input.match(/\/companies\/([^/]+)\/jobs\/([^/?#]+)/)
  if (urlMatch) return { org: urlMatch[1], slug: urlMatch[2] }

  // "org/slug" shorthand.
  if (input.includes("/") && !input.startsWith("http")) {
    const [org, ...rest] = input.split("/")
    if (org && rest.length) return { org, slug: rest.join("/") }
  }

  // Otherwise treat it as a job reference and resolve it to org + slug.
  const ref = input.trim()
  const resolved = await getJson(`${RESOLVE_API}/${encodeURIComponent(ref)}`)
  if (resolved?.website_organization_slug && resolved?.job_slug) {
    return { org: resolved.website_organization_slug, slug: resolved.job_slug }
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    const target = await resolve(opts.id)
    if (!target) {
      writeError(
        `Could not resolve "${opts.id}". Pass a job reference (from search results), an "org/slug" pair, or a WTTJ .../companies/{org}/jobs/{slug} URL.`,
        "BAD_ID",
      )
      return 1
    }

    const data = await getJson(
      `${ORG_JOB_API}/${encodeURIComponent(target.org)}/jobs/${encodeURIComponent(target.slug)}`,
    )
    const job = data?.job ?? data
    if (!job || !job.name) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const detail = toDetail(job)

    if (opts.format === "plain") {
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.location || "—"}`,
        "",
        `Remote: ${detail.remote || "—"}`,
        `Contract: ${detail.contractType || "—"}`,
        detail.experienceYears !== null ? `Experience: ${detail.experienceYears}+ years` : "",
        detail.salary ? `Salary: ${detail.salary}` : "",
        detail.skills ? `Skills: ${detail.skills.join(", ")}` : "",
        detail.date ? `Published: ${detail.date}` : "",
        "",
        detail.description || "(no description)",
        detail.profile ? "\nProfile / requirements:\n" + detail.profile : "",
        "",
        `URL: ${detail.url}`,
        detail.applyUrl ? `Apply: ${detail.applyUrl}` : "",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
