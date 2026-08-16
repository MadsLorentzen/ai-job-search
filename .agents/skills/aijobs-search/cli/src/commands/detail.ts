import { BASE_URL, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Resolve a user-supplied id/url/slug to the canonical /job/<slug>/ slug. */
export function resolveSlug(input: string): string | null {
  const s = input.trim()
  const fromPath = s.match(/\/job\/([^/?#"]+)/i)
  if (fromPath) return fromPath[1]
  if (/^https?:\/\//i.test(s)) return null // a URL but not a /job/ one
  if (/^\d+$/.test(s)) return null // bare numeric id can't build the slug URL
  return s.replace(/^\/+|\/+$/g, "") // assume it is already a slug
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = resolveSlug(opts.id)
  if (!slug) {
    writeError(
      `pass a full aijobs.net job URL or its slug id (e.g. "data-analyst-richardson-tx-us-231820"). ` +
        `A bare numeric id cannot be resolved — aijobs.net detail pages require the full slug, which "search" returns as the result id.`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const html = await htmlFetch(`${BASE_URL}/job/${slug}/`)
    if (!html) {
      writeError(`job not found: ${slug}`, "NOT_FOUND")
      return 1
    }
    const detail = parseJobDetail(html, slug)

    if (opts.format === "plain") {
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.location || "—"}`,
        `${detail.salary || "—"} · ${detail.level || "—"} · ${detail.employmentType || "—"} · ${detail.date || "—"}`,
        `apply: ${detail.applyUrl || "—"}`,
        `url: ${detail.url}`,
        "",
        detail.description || "(no description)",
      ]
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
