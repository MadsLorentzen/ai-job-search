import { fetchPage, mapJob, stripHtml, writeError, MAX_PAGES, type RawJob } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw slug or an arbeitnow.com job URL. */
export function normalizeSlug(input: string): string | null {
  const url = input.match(/arbeitnow\.com\/jobs\/(?:companies\/[^/]+\/)?([^/?#\s]+)/)
  if (url) return url[1]
  if (/^[a-z0-9][a-z0-9-]*$/i.test(input)) return input
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = normalizeSlug(opts.id)
  if (!slug) {
    writeError(`Could not parse a slug from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    let found: RawJob | undefined
    for (let p = 1; p <= MAX_PAGES; p++) {
      const data = await fetchPage(p)
      found = (data.data ?? []).find((j) => j.slug === slug)
      if (found) break
      if (!data.links?.next) break
    }
    if (!found) {
      writeError(`Job "${slug}" not found in the ${MAX_PAGES * 100} most recent listings`, "NOT_FOUND")
      return 1
    }

    const base = mapJob(found)
    const job = { ...base, jobTypes: found.job_types ?? [], description: found.description || null }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}${job.remote ? " · remote" : ""}`,
        "",
        job.tags.length > 0 ? `Tags: ${job.tags.join(", ")}` : "",
        job.jobTypes.length > 0 ? `Type: ${job.jobTypes.join(", ")}` : "",
        job.date ? `Posted: ${job.date}` : "",
        "",
        job.description ? stripHtml(job.description) : "(no description)",
        "",
        `URL: ${job.url}`,
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
