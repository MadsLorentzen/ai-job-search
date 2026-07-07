import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { parse } from "node-html-parser"
import { BASE_URL, writeError } from "../helpers.js"

interface JsonLdJobPosting {
  "@context"?: string
  "@type"?: string
  title?: string
  datePosted?: string
  validThrough?: string
  employmentType?: string | string[]
  hiringOrganization?: {
    "@type"?: string
    name?: string
    logo?: string
  }
  jobLocation?: {
    "@type"?: string
    address?: {
      "@type"?: string
      streetAddress?: string
      addressLocality?: string
      addressRegion?: string
      postalCode?: string
      addressCountry?: string
    }
  }
  description?: string
}

export const detail = defineCommand({
  name: "detail",
  description: "Full detail for a single job posting (by slug)",
  options: {
    format: option(z.enum(["json", "plain"]).default("json"), {
      description: "Output format: json, plain",
    }),
  },
  handler: async ({ flags, positional, signal }) => {
    if (signal.aborted) return

    const slug = positional[0]
    if (!slug) {
      writeError("slug argument is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const url = `${BASE_URL}/job/${slug}`

    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0",
        },
      })

      if (response.status === 404) {
        writeError("Job not found", "NOT_FOUND")
        process.exit(1)
      }

      if (!response.ok) {
        writeError(`API request failed: ${response.status} ${response.statusText}`, "API_ERROR")
        process.exit(1)
      }

      const html = await response.text()
      const root = parse(html)

      // Find JSON-LD script tag
      const ldJsonScripts = root.querySelectorAll('script[type="application/ld+json"]')
      let jobPosting: JsonLdJobPosting | null = null

      for (const script of ldJsonScripts) {
        try {
          const parsed = JSON.parse(script.text)
          if (parsed["@type"] === "JobPosting") {
            jobPosting = parsed
            break
          }
        } catch {
          // continue to next script
        }
      }

      if (!jobPosting) {
        // Check for 404 by looking at page content
        const pageTitle = root.querySelector("title")?.text ?? ""
        if (pageTitle.toLowerCase().includes("404") || html.toLowerCase().includes("siden blev ikke fundet")) {
          writeError("Job not found", "NOT_FOUND")
        } else {
          writeError("Failed to parse JSON-LD from job page", "PARSE_ERROR")
        }
        process.exit(1)
      }

      if (signal.aborted) return

      const hiringOrg = jobPosting.hiringOrganization
      const address = jobPosting.jobLocation?.address

      const employmentType = Array.isArray(jobPosting.employmentType)
        ? jobPosting.employmentType
        : jobPosting.employmentType
          ? [jobPosting.employmentType]
          : []

      const output = {
        slug,
        url,
        title: jobPosting.title ?? "",
        datePosted: jobPosting.datePosted ?? "",
        validThrough: jobPosting.validThrough ?? null,
        employmentType,
        hiringOrganization: {
          name: hiringOrg?.name ?? "",
          logo: hiringOrg?.logo ?? null,
        },
        jobLocation: {
          streetAddress: address?.streetAddress ?? null,
          addressLocality: address?.addressLocality ?? null,
          addressRegion: address?.addressRegion ?? null,
          postalCode: address?.postalCode ?? null,
          addressCountry: address?.addressCountry ?? null,
        },
        description: jobPosting.description ?? "",
      }

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

function outputPlain(data: Record<string, unknown>): void {
  console.log(`slug: ${data.slug}`)
  console.log(`url: ${data.url}`)
  console.log(`title: ${data.title}`)
  console.log(`datePosted: ${data.datePosted}`)
  console.log(`validThrough: ${data.validThrough ?? "N/A"}`)
  const empType = Array.isArray(data.employmentType) ? data.employmentType.join(", ") : "-"
  console.log(`employmentType: ${empType}`)
  const org = data.hiringOrganization as { name: string; logo: string | null }
  console.log(`company: ${org.name}`)
  const loc = data.jobLocation as {
    streetAddress: string | null
    addressLocality: string | null
    postalCode: string | null
    addressCountry: string | null
  }
  console.log(`location: ${[loc.streetAddress, loc.addressLocality, loc.postalCode, loc.addressCountry].filter(Boolean).join(", ")}`)
  console.log(`description: ${data.description}`)
}
