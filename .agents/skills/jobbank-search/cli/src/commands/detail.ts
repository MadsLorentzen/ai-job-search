import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { fetchWithUA, writeError, BASE_URL } from "../helpers.js"
import { parse as parseHtml } from "node-html-parser"

export const detail = defineCommand({
  name: "detail",
  description: "Full detail for a single job posting",
  options: {
    format: option(z.enum(["json", "plain"]).default("json"), {
      description: "Output format: json, plain",
    }),
  },
  handler: async ({ positional, flags, signal }) => {
    if (signal.aborted) return

    const id = positional[0]
    if (!id) {
      writeError("Job ID is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const url = `${BASE_URL}/job/${id}/`

    try {
      const response = await fetchWithUA(url)

      if (response.status === 404) {
        writeError("Job not found", "NOT_FOUND")
        process.exit(1)
      }

      if (!response.ok) {
        writeError(`Failed to fetch job page: ${response.status} ${response.statusText}`, "API_ERROR")
        process.exit(1)
      }

      const html = await response.text()

      if (signal.aborted) return

      const root = parseHtml(html)

      // Find all <script type="application/ld+json"> tags
      const scripts = root.querySelectorAll('script[type="application/ld+json"]')
      let jobPosting: Record<string, unknown> | null = null

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.text)
          if (json["@type"] === "JobPosting") {
            jobPosting = json
            break
          }
          // Could be an array
          if (Array.isArray(json)) {
            const found = json.find((item) => item["@type"] === "JobPosting")
            if (found) {
              jobPosting = found
              break
            }
          }
        } catch {
          // not valid JSON — skip
        }
      }

      if (!jobPosting) {
        writeError("No JSON-LD found on job page", "PARSE_ERROR")
        process.exit(1)
      }

      // Extract fields
      const identifier = jobPosting["identifier"] as Record<string, unknown> | undefined
      const jobId = identifier?.["value"] ? String(identifier["value"]) : id

      // Check if the returned job ID doesn't match what was requested — indicates not found / redirect to different job
      // We skip this check since short URL redirects to the actual job and returns 200

      const hiringOrg = jobPosting["hiringOrganization"] as Record<string, unknown> | undefined
      const jobLocation = jobPosting["jobLocation"] as Record<string, unknown> | undefined
      const address = (jobLocation?.["address"] as Record<string, unknown>) ?? {}

      const employmentType = jobPosting["employmentType"]
      const empTypeArr: string[] = Array.isArray(employmentType)
        ? employmentType.map(String)
        : employmentType
        ? [String(employmentType)]
        : []

      const validThrough = jobPosting["validThrough"]
      let deadline: string | null = null
      if (validThrough && String(validThrough).length > 0) {
        // Normalize to YYYY-MM-DD if it's an ISO datetime
        const dtStr = String(validThrough)
        deadline = dtStr.substring(0, 10) // take first 10 chars = YYYY-MM-DD
        if (deadline === "0001-01-01") deadline = null // invalid date
      }

      const output = {
        id: jobId,
        url: String(jobPosting["url"] ?? url),
        title: String(jobPosting["title"] ?? ""),
        description: String(jobPosting["description"] ?? ""),
        datePosted: String(jobPosting["datePosted"] ?? ""),
        deadline,
        employmentType: empTypeArr,
        company: {
          name: String(hiringOrg?.["name"] ?? ""),
          logo: hiringOrg?.["logo"] ? String(hiringOrg["logo"]) : null,
        },
        location: {
          streetAddress: String(address["streetAddress"] ?? ""),
          city: String(address["addressLocality"] ?? ""),
          postalCode: String(address["postalCode"] ?? ""),
          country: String(address["addressCountry"] ?? ""),
        },
      }

      // Verify the job ID matches if possible — if the page 404'd or redirected to a different job
      // For invalid IDs that redirect to a generic page, the JSON-LD may be absent
      // We already handle the "No JSON-LD" case above

      if (flags.format === "json") {
        console.log(JSON.stringify(output, null, 2))
      } else {
        outputPlain(output)
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("NOT_FOUND")) {
        writeError("Job not found", "NOT_FOUND")
      } else {
        writeError(err instanceof Error ? err.message : String(err), "API_ERROR")
      }
      process.exit(1)
    }
  },
})

function outputPlain(data: {
  id: string
  url: string
  title: string
  description: string
  datePosted: string
  deadline: string | null
  employmentType: string[]
  company: { name: string; logo: string | null }
  location: { streetAddress: string; city: string; postalCode: string; country: string }
}): void {
  console.log(`id: ${data.id}`)
  console.log(`title: ${data.title}`)
  console.log(`company: ${data.company.name}`)
  if (data.company.logo) console.log(`logo: ${data.company.logo}`)
  console.log(`location: ${[data.location.streetAddress, data.location.city, data.location.country].filter(Boolean).join(", ")}`)
  console.log(`datePosted: ${data.datePosted}`)
  console.log(`deadline: ${data.deadline ?? "none"}`)
  console.log(`employmentType: ${data.employmentType.join(", ")}`)
  console.log(`url: ${data.url}`)
  console.log("")
  // Strip HTML tags for plain description
  const plainDescription = data.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  console.log(plainDescription)
}
