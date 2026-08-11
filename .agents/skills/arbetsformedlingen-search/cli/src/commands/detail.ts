import { apiFetch, writeError, type RawHit } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw numeric ad ID or a full webpage_url (…/platsbanken/annonser/<id>). */
function normalizeId(input: string): string | null {
  const url = input.match(/\/annonser\/(\d+)/)
  if (url) return url[1]
  const bare = input.match(/^\d+$/)
  if (bare) return input
  return null
}

function renderPlain(hit: RawHit): string {
  const lines = [
    hit.headline,
    `${hit.employer?.name || "—"} · ${hit.workplace_address?.municipality || "—"}`,
    "",
    hit.occupation?.label ? `Occupation: ${hit.occupation.label}` : "",
    hit.employment_type?.label ? `Employment: ${hit.employment_type.label}` : "",
    hit.working_hours_type?.label ? `Hours: ${hit.working_hours_type.label}` : "",
    hit.duration?.label ? `Duration: ${hit.duration.label}` : "",
    hit.publication_date ? `Published: ${hit.publication_date}` : "",
    hit.application_deadline ? `Deadline: ${hit.application_deadline}` : "",
    "",
    hit.description?.text || "(no description)",
    "",
    `URL: ${hit.webpage_url}`,
    hit.application_details?.url ? `Apply: ${hit.application_details.url}` : "",
    hit.application_details?.email ? `Apply by email: ${hit.application_details.email}` : "",
  ].filter((l) => l !== "")
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse an ad ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const hit = await apiFetch<RawHit>(`/ad/${id}`)
    if (!hit) {
      writeError("Job ad not found", "NOT_FOUND")
      return 1
    }
    if (opts.format === "plain") {
      process.stdout.write(renderPlain(hit) + "\n")
    } else {
      process.stdout.write(JSON.stringify(hit, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
