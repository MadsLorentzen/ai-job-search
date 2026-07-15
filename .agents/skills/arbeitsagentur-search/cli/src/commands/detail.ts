import { apiFetch, encodeRefnr, writeError, JOB_PAGE_URL, NotFoundError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

interface RawLokation {
  adresse?: { plz?: string; ort?: string; region?: string; land?: string }
}

interface RawDetail {
  stellenangebotsTitel?: string
  firma?: string
  stellenangebotsBeschreibung?: string
  stellenlokationen?: RawLokation[]
  datumErsteVeroeffentlichung?: string
  eintrittszeitraum?: { von?: string }
  arbeitszeitVollzeit?: boolean
  vertragsdauer?: string
  verguetungsangabe?: string
  festgehalt?: number
  hauptberuf?: string
  allianzpartnerName?: string
  allianzpartnerUrl?: string
  referenznummer?: string
}

/** Accept a raw refnr (e.g. 12016-10004847581-S) or a jobdetail URL. */
export function normalizeRefnr(input: string): string | null {
  const url = input.match(/jobdetail\/([^/?#\s]+)/)
  if (url) return decodeURIComponent(url[1])
  if (/^[\w.]+-[\w-]+$/.test(input)) return input
  return null
}

function formatLocations(lokationen?: RawLokation[]): string | null {
  if (!lokationen || lokationen.length === 0) return null
  return lokationen
    .map((l) => [l.adresse?.plz, l.adresse?.ort].filter((p) => p && p !== "null").join(" "))
    .filter((s) => s.length > 0)
    .join("; ") || null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const refnr = normalizeRefnr(opts.id)
  if (!refnr) {
    writeError(`Could not parse a refnr from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const raw = await apiFetch<RawDetail>(`/pc/v3/jobdetails/${encodeRefnr(refnr)}`)
    const job = {
      id: raw.referenznummer || refnr,
      title: raw.stellenangebotsTitel || null,
      company: raw.firma || null,
      location: formatLocations(raw.stellenlokationen),
      date: raw.datumErsteVeroeffentlichung || null,
      startDate: raw.eintrittszeitraum?.von || null,
      fullTime: raw.arbeitszeitVollzeit ?? null,
      contractDuration: raw.vertragsdauer || null,
      salaryType: raw.verguetungsangabe || null,
      salary: raw.festgehalt ?? null,
      occupation: raw.hauptberuf || null,
      partnerName: raw.allianzpartnerName || null,
      partnerUrl: raw.allianzpartnerUrl || null,
      description: raw.stellenangebotsBeschreibung || null,
      url: `${JOB_PAGE_URL}/${encodeURIComponent(refnr)}`,
    }

    if (opts.format === "plain") {
      const lines = [
        job.title || "(ohne Titel)",
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.occupation ? `Beruf: ${job.occupation}` : "",
        job.startDate ? `Eintritt: ${job.startDate}` : "",
        job.fullTime !== null ? `Arbeitszeit: ${job.fullTime ? "Vollzeit" : "Teilzeit"}` : "",
        job.contractDuration && job.contractDuration !== "KEINE_ANGABE" ? `Vertrag: ${job.contractDuration}` : "",
        job.salary !== null ? `Vergütung: ${job.salary} (${job.salaryType || "—"})` : "",
        "",
        job.description || "(keine Beschreibung)",
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    if (e instanceof NotFoundError) {
      writeError(e.message, "NOT_FOUND")
      return 1
    }
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
