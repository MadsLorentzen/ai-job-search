import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

export interface SearchApiResponse {
  jobAds: JobAdRaw[]
  searchFacets: SearchFacetsRaw
  totalJobAdCount: number
  searchString: string | null
}

export interface JobAdRaw {
  jobAdId: string
  title: string
  hiringOrgName: string
  occupation: string | null
  municipality: string | null
  postalCode: number | null
  postalDistrictName: string | null
  country: string
  publicationDate: string
  applicationDeadline: string | null
  applicationDeadlineStatus: string | null
  workHourPartTime: boolean
  isExternal: boolean
  hasLogo: boolean
  logoUrl: string | null
  cvr: string | null
  workPlaceAddress: string
  conceptUriDa?: string | null
  isSeen: boolean
  isFavorite: boolean
  description?: string
}

export interface SearchFacetsRaw {
  regions: Array<{ type: string; jobAdCount: number }>
  workHours: Array<{ type: string; jobAdCount: number }>
  employmentDurations: Array<{ type: string; jobAdCount: number }>
  occupationAreas: Array<{ identifier: string; jobAdCount: number }>
  countries: Array<{ label: string; identifier: string; jobAdCount: number }>
}

export interface SearchFlags {
  "search-string"?: string
  page: number
  "per-page": number
  order: string
  region?: string
  "work-hours"?: string
  duration?: string
  "job-type"?: string
  "postal-code"?: string
  radius: number
  "occupation-area"?: string
  "occupation-group"?: string
  limit?: number
}

export function buildSearchParams(flags: SearchFlags): Record<string, string> {
  const params: Record<string, string> = {
    resultsPerPage: String(flags["per-page"]),
    pageNumber: String(flags.page),
    orderType: flags.order,
  }

  if (flags["search-string"]) params["searchString"] = flags["search-string"]
  if (flags.region) params["regions"] = flags.region
  if (flags["work-hours"]) params["workHoursType"] = flags["work-hours"]
  if (flags.duration) params["employmentDurationType"] = flags.duration
  if (flags["job-type"]) params["jobAnnouncementType"] = flags["job-type"]
  if (flags["postal-code"]) {
    params["postalCode"] = flags["postal-code"]
    params["kmRadius"] = String(flags.radius)
  }
  if (flags["occupation-area"]) params["occupationAreas"] = flags["occupation-area"]
  if (flags["occupation-group"]) params["occupationGroups"] = flags["occupation-group"]

  return params
}

export function createSearchOutput(data: SearchApiResponse, flags: SearchFlags) {
  let results = data.jobAds.map((job) => ({
    jobAdId: job.jobAdId,
    title: job.title,
    hiringOrgName: job.hiringOrgName,
    occupation: job.occupation ?? null,
    municipality: job.municipality ?? null,
    postalCode: job.postalCode ?? null,
    postalDistrictName: job.postalDistrictName ?? null,
    country: job.country,
    publicationDate: job.publicationDate,
    applicationDeadline: job.applicationDeadline ?? null,
    applicationDeadlineStatus: job.applicationDeadlineStatus ?? null,
    workHourPartTime: job.workHourPartTime,
    isExternal: job.isExternal,
    hasLogo: job.hasLogo,
    logoUrl: job.logoUrl ?? null,
    cvr: job.cvr ?? null,
    workPlaceAddress: job.workPlaceAddress ?? "",
    isSeen: job.isSeen,
    isFavorite: job.isFavorite,
  }))

  if (flags.limit !== undefined) {
    results = results.slice(0, flags.limit)
  }

  const facets = {
    regions: data.searchFacets.regions ?? [],
    workHours: data.searchFacets.workHours ?? [],
    employmentDurations: data.searchFacets.employmentDurations ?? [],
    occupationAreas: data.searchFacets.occupationAreas ?? [],
    countries: data.searchFacets.countries ?? [],
  }

  const meta = {
    totalJobAdCount: data.totalJobAdCount,
    pageNumber: flags.page,
    resultsPerPage: flags["per-page"],
    searchString: data.searchString ?? null,
  }

  return { meta, facets, results }
}

export const search = defineCommand({
  name: "search",
  description: "Search for job ads with filters",
  options: {
    "search-string": option(z.string().optional(), {
      description: "Free-text keyword search (job title, skills, employer)",
    }),
    page: option(z.coerce.number().default(1), {
      description: "Page number (1-indexed)",
    }),
    "per-page": option(z.coerce.number().default(10), {
      description: "Results per page",
    }),
    order: option(z.string().default("PublicationDate"), {
      description: "Sort order: PublicationDate, BestMatch, ApplicationDate",
    }),
    region: option(z.string().optional(), {
      description: "One region value",
    }),
    "work-hours": option(z.string().optional(), {
      description: "FullTime or PartTime",
    }),
    duration: option(z.string().optional(), {
      description: "Permanent or Temporary",
    }),
    "job-type": option(z.string().optional(), {
      description: "Announcement type: Ordinaert, Efterloenner, Foertidspension",
    }),
    "postal-code": option(z.string().optional(), {
      description: "Postal code for radius search",
    }),
    radius: option(z.coerce.number().default(50), {
      description: "Radius in km from postal code",
    }),
    "occupation-area": option(z.string().optional(), {
      description: "Occupation area identifier, e.g. 10000",
    }),
    "occupation-group": option(z.string().optional(), {
      description: "Occupation group identifier, e.g. 10060",
    }),
    limit: option(z.coerce.number().optional(), {
      description: "Cap total results returned by CLI",
    }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), {
      description: "Output format: json, table, plain",
    }),
  },
  handler: async ({ flags, signal }) => {
    if (signal.aborted) return

    const params = buildSearchParams(flags)

    try {
      const data = await apiFetch<SearchApiResponse>("/FindJob/Search", params)

      if (signal.aborted) return

      const output = createSearchOutput(data, flags)

      if (flags.format === "json") {
        console.log(JSON.stringify(output, null, 2))
      } else if (flags.format === "table") {
        outputTable(output.results)
      } else {
        outputPlain(output.results)
      }
    } catch (err) {
      writeError(err instanceof Error ? err.message : String(err), "API_ERROR")
      process.exit(1)
    }
  },
})

type JobAdResult = {
  jobAdId: string
  title: string
  hiringOrgName: string
  occupation: string | null
  municipality: string | null
  postalCode: number | null
  publicationDate: string
  applicationDeadline: string | null
}

function outputTable(results: JobAdResult[]): void {
  console.log("jobAdId                              title                                employer                   municipality")
  for (const r of results) {
    const id = r.jobAdId.padEnd(36)
    const title = (r.title ?? "-").substring(0, 36).padEnd(36)
    const employer = (r.hiringOrgName ?? "-").substring(0, 26).padEnd(26)
    const municipality = String(r.municipality ?? "-")
    console.log(`${id} ${title} ${employer} ${municipality}`)
  }
}

function outputPlain(results: JobAdResult[]): void {
  for (const r of results) {
    console.log(`id: ${r.jobAdId}`)
    console.log(`title: ${r.title}`)
    console.log(`employer: ${r.hiringOrgName}`)
    console.log(`occupation: ${r.occupation ?? "-"}`)
    console.log(`municipality: ${r.municipality ?? "-"}`)
    console.log(`published: ${r.publicationDate}`)
    console.log(`deadline: ${r.applicationDeadline ?? "-"}`)
    console.log("")
  }
}
