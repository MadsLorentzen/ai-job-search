import { htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  input: string
  format: "json" | "plain"
}

const HEX_ID = /([0-9a-f]{32})/i

/**
 * Computrabajo's posting address includes the job slug, so a bare id cannot
 * address the page: accept the full URL (as emitted by search results) or the
 * relative path, stripping the #lc= fragment and query string.
 */
export function normalizeDetailUrl(input: string): string | null {
  const t = input.trim()
  if (/^https?:\/\//i.test(t)) {
    return t.split("#")[0].split("?")[0]
  }
  if (t.startsWith("/")) {
    return t.split("#")[0].split("?")[0]
  }
  return null
}

export function idFromUrl(url: string): string | null {
  const m = url.match(HEX_ID)
  return m ? m[1].toLowerCase() : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const url = normalizeDetailUrl(opts.input)
  const id = url ? idFromUrl(url) : null
  if (!url || !id || !/ofertas-de-trabajo/.test(url)) {
    writeError(
      `Could not parse a Computrabajo posting URL from "${opts.input}" (pass the full URL from search results — the address includes the job slug)`,
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
    const job = parseJobDetail(html, url, id)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        job.salary ? `Salary: ${job.salary}` : "",
        job.date ? `Posted: ${job.date}` : "",
        "",
        job.description || "(no description)",
        "",
        ...(job.requirements.length > 0
          ? ["Requirements:", ...job.requirements.map((r) => `  • ${r}`)]
          : []),
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