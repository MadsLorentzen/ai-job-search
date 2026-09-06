import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, normalizeJobId, writeError, stripHtml } from "../helpers.js"
import type { JobAdRaw, SearchApiResponse } from "./search.js"

export interface DetailApiResponse {
  id: string
  title: string
  body: string
  publicationDateTime: string
  unpublicationDateTime: string | null
  approvalStatus: string
  views: number
  createdDateTime: string
  updatedDateTime: string
  isAnonymousEmployer: boolean
  hasLogo: boolean
  logoUrl: string | null
  employer: {
    cvrNumber: string | null
    pNumber: string | null
    name: string
    hasCompanyLogo: boolean
  }
  job: {
    type: string
    address: {
      streetName: string | null
      city: string | null
      postalCode: string | null
      municipality: string | null
      countryCode: string
      countryName: string
    }
    noFixedWorkplace: boolean
    isLimitedPeriod: boolean
    isDisabilityFriendly: boolean
    isPartTime: boolean
    employmentDate: string | null
    conceptUriDa: string | null
    preferredLabelDa: string | null
    driversLicenses: unknown[]
    classifications: unknown[]
    shifts: unknown[]
    isFavorite: boolean
  }
  application: {
    deadlineDate: string | null
    availablePositions: number
    contactPersons: Array<{
      firstNames: string | null
      lastName: string | null
      phoneNumber: string | null
    }>
    url: string | null
    urlText: string | null
    isApplicationDeadlineASAP: boolean
  }
  organisationTypeId: number | null
  user: string | null
}

/**
 * Maps a raw JobAd from the search endpoint to a DetailApiResponse.
 * Used as a fallback when /FindJob/JobAdDetails/<id> returns 404 for external ads (#432).
 */
export function mapSearchAdToDetail(raw: JobAdRaw & { jobAdUrl?: string | null; jobAnnouncementTypeName?: string | null }): DetailApiResponse {
  const street = raw.workPlaceAddress ? raw.workPlaceAddress.trim() : null
  return {
    id: raw.jobAdId,
    title: raw.title,
    body: raw.description ?? "",
    publicationDateTime: raw.publicationDate ?? "",
    unpublicationDateTime: null,
    approvalStatus: "Godkendt",
    views: 0,
    createdDateTime: raw.publicationDate ?? "",
    updatedDateTime: raw.publicationDate ?? "",
    isAnonymousEmployer: false,
    hasLogo: Boolean(raw.hasLogo),
    logoUrl: raw.logoUrl ?? null,
    employer: {
      cvrNumber: raw.cvr ?? null,
      pNumber: null,
      name: raw.hiringOrgName ?? "",
      hasCompanyLogo: Boolean(raw.hasLogo),
    },
    job: {
      type: raw.jobAnnouncementTypeName || (raw.workHourPartTime ? "PartTime" : "FullTime"),
      address: {
        streetName: street && street.length > 0 ? street : null,
        city: raw.postalDistrictName ?? raw.municipality ?? null,
        postalCode: raw.postalCode ? String(raw.postalCode) : null,
        municipality: raw.municipality ?? null,
        countryCode: raw.country === "Danmark" ? "DK" : (raw.country || "DK"),
        countryName: raw.country || "Danmark",
      },
      noFixedWorkplace: false,
      isLimitedPeriod: false,
      isDisabilityFriendly: false,
      isPartTime: Boolean(raw.workHourPartTime),
      employmentDate: null,
      conceptUriDa: raw.conceptUriDa ?? null,
      preferredLabelDa: raw.occupation ?? null,
      driversLicenses: [],
      classifications: [],
      shifts: [],
      isFavorite: Boolean(raw.isFavorite),
    },
    application: {
      deadlineDate: raw.applicationDeadline ?? null,
      availablePositions: 1,
      contactPersons: [],
      url: raw.jobAdUrl && raw.jobAdUrl.trim().length > 0 ? raw.jobAdUrl.trim() : null,
      urlText: null,
      isApplicationDeadlineASAP: raw.applicationDeadlineStatus === "NotDisclosed",
    },
    organisationTypeId: null,
    user: null,
  }
}

/**
 * Normalize a raw detail response before any output format sees it.
 *
 * The API's "deadline not disclosed" sentinel is 1900-01-01 (it arrives with
 * isApplicationDeadlineASAP / an applicationDeadlineStatus of NotDisclosed).
 * The search command already maps that sentinel to null; detail must agree,
 * or an undisclosed deadline reads as 126 years expired and /rank's expiry
 * sweep retires the job the moment it is stored.
 */
export function prepareDetail(data: DetailApiResponse): DetailApiResponse {
  const deadline = data.application.deadlineDate
  if (deadline && deadline.startsWith("1900-01-01")) {
    data.application.deadlineDate = null
  }
  return data
}

export const detail = defineCommand({
  name: "detail",
  description: "Full detail for a single job ad",
  options: {
    format: option(z.enum(["json", "table", "plain"]).default("json"), {
      description: "Output format: json, table, plain",
    }),
  },
  handler: async ({ positional, flags, signal }) => {
    if (signal.aborted) return

    const rawId = positional[0] as string | undefined
    if (!rawId) {
      writeError("Job ad ID is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const id = normalizeJobId(rawId)
    if (!id) {
      writeError(`Could not parse job ad ID from "${rawId}"`, "BAD_ID")
      process.exit(1)
    }

    let data: DetailApiResponse | null = null

    try {
      data = prepareDetail(
        await apiFetch<DetailApiResponse>(`/FindJob/JobAdDetails/${id}`, {
          incrementViews: "false",
        }),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("404") || message.includes("Not Found")) {
        // Fallback for external ads: JobAdDetails returns 404 for ads with isExternal: true,
        // but /FindJob/Search returns the full ad object including HTML description (#432).
        try {
          const searchResult = await apiFetch<SearchApiResponse>("/FindJob/Search", {
            searchString: id,
            resultsPerPage: "5",
            pageNumber: "1",
            orderType: "PublicationDate",
          })
          const match = searchResult.jobAds?.find((ad) => ad.jobAdId === id)
          if (match) {
            data = prepareDetail(mapSearchAdToDetail(match))
          }
        } catch {
          // If fallback search fails, fall through to NOT_FOUND
        }

        if (!data) {
          writeError("Job ad not found", "NOT_FOUND")
          process.exit(1)
        }
      } else {
        writeError(message, "API_ERROR")
        process.exit(1)
      }
    }

    if (signal.aborted || !data) return

    if (flags.format === "json") {
      console.log(JSON.stringify(data, null, 2))
    } else if (flags.format === "table") {
      outputTable(data)
    } else {
      outputPlain(data)
    }
  },
})

function outputTable(data: DetailApiResponse): void {
  console.log(`ID:          ${data.id}`)
  console.log(`Title:       ${data.title}`)
  console.log(`Employer:    ${data.employer.name}`)
  console.log(`Type:        ${data.job.type}`)
  console.log(`City:        ${data.job.address.city ?? "-"}`)
  console.log(`Postal:      ${data.job.address.postalCode ?? "-"}`)
  console.log(`Country:     ${data.job.address.countryName}`)
  console.log(`Published:   ${data.publicationDateTime}`)
  console.log(`Deadline:    ${data.application.deadlineDate ?? "-"}`)
  console.log(`Positions:   ${data.application.availablePositions}`)
  console.log(`Apply URL:   ${data.application.url ?? "-"}`)
}

function outputPlain(data: DetailApiResponse): void {
  console.log(formatDetailPlain(data))
}

export function formatDetailPlain(data: DetailApiResponse): string {
  const lines = [
    `Title: ${data.title}`,
    `Employer: ${data.employer.name}`,
    `Location: ${data.job.address.city ?? "-"}, ${data.job.address.countryName}`,
    `Published: ${data.publicationDateTime}`,
    `Deadline: ${data.application.deadlineDate ?? "-"}`,
    `Positions: ${data.application.availablePositions}`,
  ]

  if (data.application.url) {
    lines.push(`Apply: ${data.application.url}`)
  }

  lines.push("", stripHtml(data.body))
  return lines.join("\n")
}
