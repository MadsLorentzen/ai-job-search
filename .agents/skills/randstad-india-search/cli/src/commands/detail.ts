import { BASE_URL, htmlFetch, parseJobDetail, idFromUrl, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Randstad detail pages are keyed by a slug + city + UUID
 * (`/jobs/<slug>_<city>_<uuid>/`). The slug cannot be reconstructed from a bare
 * UUID, so `detail` takes the full job URL emitted in a search result's `url`
 * field (a `/jobs/...` path or absolute URL is accepted).
 */
function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (/^https?:\/\/[^/]*randstad\.in\/jobs\/.+_[0-9a-f-]{36}\/?$/i.test(trimmed)) {
    return trimmed
  }
  if (/^\/jobs\/.+_[0-9a-f-]{36}\/?$/i.test(trimmed)) {
    return BASE_URL + trimmed
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const url = normalizeUrl(opts.id)
  if (!url || !idFromUrl(url)) {
    writeError(
      `detail requires a full Randstad job URL (the "url" field from a search result), e.g. https://www.randstad.in/jobs/project-manager-structural_pune_8b8726ea-cf54-4912-9f6d-d11e25f6fbee/`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const html = await htmlFetch(url)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, url)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.displayId ? `Ref: ${job.displayId}` : "",
        job.date ? `Posted: ${job.date.slice(0, 10)}` : "",
        "",
        job.description || "(no description)",
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
