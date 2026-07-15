import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError, stripHtml } from "../helpers.js"

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

    const id = positional[0] as string | undefined
    if (!id) {
      writeError("Job ad ID is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    try {
      const data = await apiFetch<DetailApiResponse>(
        `/FindJob/JobAdDetails/${id}`,
        { incrementViews: "false" }
      )

      if (signal.aborted) return

      if (flags.format === "json") {
        console.log(JSON.stringify(data, null, 2))
      } else if (flags.format === "table") {
        outputTable(data)
      } else {
        outputPlain(data)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("404") || message.includes("Not Found")) {
        writeError("Job ad not found", "NOT_FOUND")
      } else {
        writeError(message, "API_ERROR")
      }
      process.exit(1)
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
