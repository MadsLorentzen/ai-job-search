// Per-ATS fetch + normalize functions. Each public API has its own JSON shape;
// see url-reference.md for full field docs and quirks.

import { jsonFetch, htmlFetch, scrapeGenericLinks, applyLocationsFilter, type NormalizedJob, type RegistryEntry } from "./helpers.js"

/**
 * A list endpoint that answers "not found" means the registry's ats_id is wrong,
 * not that the employer has no openings. Returning [] there is indistinguishable
 * from a genuinely empty board, so a typo'd token silently reads as "nothing
 * open here" for as long as it goes unnoticed. Fail loudly instead.
 */
function requireBoard(data: unknown, entry: RegistryEntry, what: string): void {
  if (data === null) {
    throw new Error(
      `${what} for "${entry.name}" returned 404 - ats_id "${entry.ats_id}" looks wrong [url_not_found]`,
    )
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
}

function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null
  // Greenhouse/SmartRecruiters sometimes double-encode: the field value is a
  // literal string containing "&lt;h2&gt;..." rather than real "<h2>" tags, so
  // decode entities BEFORE stripping tags (decode -> strip -> decode again for
  // any entities that were themselves inside the tag-stripped text).
  const decodedOnce = decodeEntities(s)
  const stripped = decodedOnce.replace(/<[^>]+>/g, " ")
  return decodeEntities(stripped).replace(/\s+/g, " ").trim() || null
}

// ---------------------------------------------------------------------------
// Greenhouse — https://boards-api.greenhouse.io/v1/boards/<board_token>/jobs
// ---------------------------------------------------------------------------

interface GreenhouseJob {
  id: number
  title: string
  absolute_url: string
  updated_at?: string
  location?: { name?: string }
  content?: string
}

export async function fetchGreenhouse(entry: RegistryEntry, detailed = false): Promise<NormalizedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(entry.ats_id)}/jobs${detailed ? "?content=true" : ""}`
  const data = (await jsonFetch(url)) as { jobs?: GreenhouseJob[] } | null
  requireBoard(data, entry, "Greenhouse board")
  const jobs = data?.jobs ?? []
  const normalized = jobs.map((j) => ({
    company: entry.name,
    title: j.title,
    location: j.location?.name ?? null,
    url: j.absolute_url,
    posted: j.updated_at ?? null,
    source_ats: "greenhouse" as const,
    id: String(j.id),
  }))
  return applyLocationsFilter(normalized, entry)
}

export async function fetchGreenhouseDetail(boardId: string, jobId: string): Promise<Record<string, unknown> | null> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardId)}/jobs/${encodeURIComponent(jobId)}?questions=true`
  const data = (await jsonFetch(url)) as GreenhouseJob | null
  if (!data) return null
  return {
    id: String(data.id),
    title: data.title,
    location: data.location?.name ?? null,
    url: data.absolute_url,
    posted: data.updated_at ?? null,
    source_ats: "greenhouse",
    description: stripHtml(data.content),
  }
}

// ---------------------------------------------------------------------------
// Lever — https://api.lever.co/v0/postings/<company>?mode=json
// ---------------------------------------------------------------------------

interface LeverJob {
  id: string
  text: string
  hostedUrl: string
  createdAt?: number
  categories?: { location?: string; team?: string; commitment?: string }
  descriptionPlain?: string
  description?: string
}

export async function fetchLever(entry: RegistryEntry): Promise<NormalizedJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(entry.ats_id)}?mode=json`
  const data = (await jsonFetch(url)) as LeverJob[] | { ok: false; error: string } | null
  requireBoard(data, entry, "Lever board")
  if (!Array.isArray(data)) {
    // Lever answers a bad token with 200 and an error object. Treating that as
    // zero jobs hid the misconfiguration behind a plausible empty result.
    const detail = data && typeof data === "object" && "error" in data ? String(data.error) : "unexpected shape"
    throw new Error(`Lever board for "${entry.name}" did not return a job list: ${detail} [url_not_found]`)
  }
  const normalized = data.map((j) => ({
    company: entry.name,
    title: j.text,
    location: j.categories?.location ?? null,
    url: j.hostedUrl,
    posted: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    source_ats: "lever" as const,
    id: j.id,
  }))
  return applyLocationsFilter(normalized, entry)
}

export async function fetchLeverDetail(company: string, jobId: string): Promise<Record<string, unknown> | null> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}/${encodeURIComponent(jobId)}?mode=json`
  const data = (await jsonFetch(url)) as LeverJob | { ok: false } | null
  if (!data || (data as { ok?: boolean }).ok === false) return null
  const j = data as LeverJob
  return {
    id: j.id,
    title: j.text,
    location: j.categories?.location ?? null,
    url: j.hostedUrl,
    posted: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    source_ats: "lever",
    description: j.descriptionPlain ?? stripHtml(j.description),
  }
}

// ---------------------------------------------------------------------------
// SmartRecruiters — https://api.smartrecruiters.com/v1/companies/<id>/postings
// ---------------------------------------------------------------------------

interface SmartRecruitersJob {
  id: string
  name: string
  releasedDate?: string
  location?: { city?: string; region?: string; country?: string }
  ref?: string
}

export async function fetchSmartRecruiters(entry: RegistryEntry): Promise<NormalizedJob[]> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(entry.ats_id)}/postings`
  const data = (await jsonFetch(url)) as { content?: SmartRecruitersJob[] } | null
  requireBoard(data, entry, "SmartRecruiters company")
  const jobs = data?.content ?? []
  const normalized = jobs.map((j) => {
    const locParts = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean)
    return {
      company: entry.name,
      title: j.name,
      location: locParts.length ? locParts.join(", ") : null,
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(entry.ats_id)}/${j.id}`,
      posted: j.releasedDate ?? null,
      source_ats: "smartrecruiters" as const,
      id: j.id,
    }
  })
  return applyLocationsFilter(normalized, entry)
}

export async function fetchSmartRecruitersDetail(companyId: string, jobId: string): Promise<Record<string, unknown> | null> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings/${encodeURIComponent(jobId)}`
  const data = (await jsonFetch(url)) as (SmartRecruitersJob & { jobAd?: { sections?: Record<string, { title?: string; text?: string }> } }) | null
  if (!data) return null
  const locParts = [data.location?.city, data.location?.region, data.location?.country].filter(Boolean)
  const sections = data.jobAd?.sections ?? {}
  const description = Object.values(sections)
    .map((s) => stripHtml(s.text))
    .filter(Boolean)
    .join("\n\n")
  return {
    id: data.id,
    title: data.name,
    location: locParts.length ? locParts.join(", ") : null,
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(companyId)}/${data.id}`,
    posted: data.releasedDate ?? null,
    source_ats: "smartrecruiters",
    description: description || null,
  }
}

// ---------------------------------------------------------------------------
// Generic — fetch careers_url HTML, strip tags, extract job-ish links.
// ---------------------------------------------------------------------------

export async function fetchGeneric(entry: RegistryEntry): Promise<NormalizedJob[]> {
  const html = await htmlFetch(entry.careers_url)
  if (!html) return []
  const normalized = scrapeGenericLinks(html, entry.careers_url, entry.name)
  return applyLocationsFilter(normalized, entry)
}

// ---------------------------------------------------------------------------
// Oracle Cloud HCM "Candidate Experience" (Oracle CX) — the ATS behind a large
// share of European bank and corporate career sites. It exposes an
// unauthenticated REST endpoint alongside the JS portal:
//
//   https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions
//     ?onlyData=true&finder=findReqs;siteNumber=<siteNumber>,limit=<n>,sortBy=POSTING_DATES_DESC
//
// ats_id encodes both parts as "<host>|<siteNumber>", because the host is
// tenant-specific and cannot be derived from the company name.
// Example (verified): "iaadtu.fa.ocs.oraclecloud.eu|CX_1" -> UBP, 43 live jobs.
//
// Without this adapter these sites fell to ats=generic, which scrapes the JS
// shell and returns nothing — the portal renders its listings client-side.
// ---------------------------------------------------------------------------

interface OracleRequisition {
  Id: string
  Title: string
  PostedDate?: string | null
  PrimaryLocation?: string | null
  PrimaryLocationCountry?: string | null
  ShortDescriptionStr?: string | null
}

export function parseOracleAtsId(atsId: string): { host: string; siteNumber: string } | null {
  const [host, siteNumber] = atsId.split("|")
  if (!host || !siteNumber) return null
  return { host: host.replace(/^https?:\/\//, "").replace(/\/$/, ""), siteNumber }
}

export async function fetchOracle(entry: RegistryEntry, limit = 200): Promise<NormalizedJob[]> {
  const parsed = parseOracleAtsId(entry.ats_id)
  if (!parsed) {
    throw new Error(
      `Oracle entry "${entry.name}" needs ats_id in the form "<host>|<siteNumber>" (e.g. "iaadtu.fa.ocs.oraclecloud.eu|CX_1"), got "${entry.ats_id}"`,
    )
  }
  const { host, siteNumber } = parsed
  const finder = `findReqs;siteNumber=${siteNumber},limit=${limit},sortBy=POSTING_DATES_DESC`
  const url =
    `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
    `?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`

  const data = (await jsonFetch(url)) as { items?: { requisitionList?: OracleRequisition[] }[] } | null
  requireBoard(data, entry, "Oracle CX site")
  const reqs = data?.items?.[0]?.requisitionList ?? []

  const normalized = reqs.map((r) => ({
    company: entry.name,
    title: r.Title,
    location: r.PrimaryLocation ?? r.PrimaryLocationCountry ?? null,
    // The portal's own job permalink, so the URL is one a human can open.
    url: `https://${host}/hcmUI/CandidateExperience/en/sites/${siteNumber}/job/${r.Id}`,
    posted: r.PostedDate ?? null,
    source_ats: "oracle" as const,
    id: r.Id,
  }))
  return applyLocationsFilter(normalized, entry)
}

/**
 * Oracle CX job detail. Verified against UBP (iaadtu.fa.ocs.oraclecloud.eu, CX_1,
 * job 1451): `finder=ById;Id=<jobId>,siteNumber=<site>` with no `expand` — the
 * endpoint rejects the `expand` values the list resource accepts, and rejects
 * `jobId=` as the finder key.
 */
export async function fetchOracleDetail(atsId: string, jobId: string): Promise<Record<string, unknown> | null> {
  const parsed = parseOracleAtsId(atsId)
  if (!parsed) {
    throw new Error(
      `Oracle entry needs ats_id in the form "<host>|<siteNumber>" (e.g. "iaadtu.fa.ocs.oraclecloud.eu|CX_1"), got "${atsId}"`,
    )
  }
  const { host, siteNumber } = parsed
  const finder = `ById;Id=${jobId},siteNumber=${siteNumber}`
  const url =
    `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
    `?onlyData=true&finder=${encodeURIComponent(finder)}`

  const data = (await jsonFetch(url)) as { items?: Record<string, unknown>[] } | null
  const item = data?.items?.[0]
  if (!item) return null
  const description = [item.ExternalDescriptionStr, item.OrganizationDescriptionStr, item.CorporateDescriptionStr]
    .map((s) => stripHtml(typeof s === "string" ? s : ""))
    .filter(Boolean)
    .join("\n\n")
  return {
    id: String(item.Id ?? jobId),
    title: item.Title ?? null,
    location: (item.PrimaryLocation as string | null) ?? (item.PrimaryLocationCountry as string | null) ?? null,
    url: `https://${host}/hcmUI/CandidateExperience/en/sites/${siteNumber}/job/${jobId}`,
    posted: (item.ExternalPostedStartDate as string | null) ?? null,
    source_ats: "oracle",
    description: description || null,
  }
}
