import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiPost, writeError, BASE_URL } from "../helpers.js"

interface ApiSearchItem {
  title: string
  companyName: string
  companyLogo: {
    key: string
    url: string
    focalPoint: { top: number; left: number } | null
  } | null
  companyLogoSvgMarkup: string | null
  overlayColor: string | null
  companyAddress: string
  jobTypes: string[]
  boostJob: boolean
  publishedDate: string
  applicationDeadline: string | null
  url: string
  coverImage: {
    key: string
    url: string
    focalPoint: { top: number; left: number } | null
  } | null
  silhouetteLogo: boolean
}

interface ApiSearchResponse {
  items: ApiSearchItem[]
  currentPage: number
  totalItems: number
  itemsPrPage: number
  totalPages: number
}

function normalizeItem(item: ApiSearchItem): Record<string, unknown> {
  const relativeUrl = item.url
  const fullUrl = relativeUrl.startsWith("http")
    ? relativeUrl
    : `${BASE_URL}${relativeUrl}`
  // Extract slug from url path: /job/<slug>
  const slug = relativeUrl.replace(/^\/job\//, "")

  const companyLogo = item.companyLogo
    ? {
        key: item.companyLogo.key,
        url: item.companyLogo.url.startsWith("http")
          ? item.companyLogo.url
          : `${BASE_URL}${item.companyLogo.url}`,
        focalPoint: item.companyLogo.focalPoint,
      }
    : null

  const coverImage = item.coverImage
    ? {
        key: item.coverImage.key,
        url: item.coverImage.url.startsWith("http")
          ? item.coverImage.url
          : `${BASE_URL}${item.coverImage.url}`,
        focalPoint: item.coverImage.focalPoint,
      }
    : null

  return {
    title: item.title,
    companyName: item.companyName,
    companyLogo,
    companyLogoSvgMarkup: item.companyLogoSvgMarkup ?? null,
    overlayColor: item.overlayColor ?? null,
    companyAddress: item.companyAddress,
    jobTypes: item.jobTypes,
    boostJob: item.boostJob,
    publishedDate: item.publishedDate,
    applicationDeadline: item.applicationDeadline ?? null,
    url: fullUrl,
    slug,
    coverImage,
    silhouetteLogo: item.silhouetteLogo,
  }
}

export const search = defineCommand({
  name: "search",
  description: "Search job listings with filters",
  options: {
    text: option(z.string().optional(), {
      description: "Free-text keyword search (job title, keyword)",
    }),
    category: option(z.coerce.number().optional(), {
      description: "Category ID",
    }),
    "jobtitle-id": option(z.coerce.number().optional(), {
      description: "Job title ID from autocomplete results",
    }),
    municipality: option(z.string().optional(), {
      description: "Municipality name, e.g. Odense, København",
    }),
    zip: option(z.string().optional(), {
      description: "Zip code, e.g. 5000",
    }),
    region: option(z.string().optional(), {
      description: "Region name",
    }),
    "job-type": option(z.string().optional(), {
      description: "Comma-separated job types: fuldtid,deltid,fleksjob,elev,studiejob,praktik",
    }),
    page: option(z.coerce.number().default(1), {
      description: "Page number (30 items per page, server-enforced)",
    }),
    limit: option(z.coerce.number().optional(), {
      description: "Cap total results returned by CLI (client-side)",
    }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), {
      description: "Output format: json, table, plain",
    }),
  },
  handler: async ({ flags, signal }) => {
    if (signal.aborted) return

    const filters: Array<{ type: string; value: string | number; displayText: string }> = []

    if (flags.text) {
      filters.push({ type: "freetext", value: flags.text, displayText: flags.text })
    }
    if (flags.category !== undefined) {
      filters.push({ type: "category", value: flags.category, displayText: String(flags.category) })
    }
    if (flags["jobtitle-id"] !== undefined) {
      filters.push({ type: "jobtitle", value: flags["jobtitle-id"], displayText: String(flags["jobtitle-id"]) })
    }
    if (flags.municipality) {
      filters.push({ type: "municipality", value: flags.municipality, displayText: flags.municipality })
    }
    if (flags.zip) {
      filters.push({ type: "zip", value: flags.zip, displayText: flags.zip })
    }
    if (flags.region) {
      filters.push({ type: "region", value: flags.region, displayText: flags.region })
    }

    const jobTypes = flags["job-type"]
      ? flags["job-type"].split(",").map((t) => t.trim()).filter(Boolean)
      : []

    const body = {
      jobTypes,
      filters,
      locationMode: "Text",
      distance: 50,
    }

    try {
      const data = await apiPost<ApiSearchResponse>(`/api/jobsearch/search/${flags.page}`, body)

      if (signal.aborted) return

      let results = data.items.map(normalizeItem)
      if (flags.limit !== undefined) {
        results = results.slice(0, flags.limit)
      }

      const meta = {
        currentPage: data.currentPage,
        totalItems: data.totalItems,
        itemsPrPage: data.itemsPrPage,
        totalPages: data.totalPages,
      }

      const output = { meta, results }

      if (flags.format === "json") {
        console.log(JSON.stringify(output, null, 2))
      } else if (flags.format === "table") {
        outputTable(results)
      } else {
        outputPlain(results)
      }
    } catch (err) {
      writeError(err instanceof Error ? err.message : String(err), "API_ERROR")
      process.exit(1)
    }
  },
})

function outputTable(results: Record<string, unknown>[]): void {
  console.log("title                                company                    date       url")
  for (const r of results) {
    const title = String(r.title ?? "-").substring(0, 35).padEnd(35)
    const company = String(r.companyName ?? "-").substring(0, 25).padEnd(25)
    const date = String(r.publishedDate ?? "-").padEnd(10)
    const url = String(r.url ?? "-")
    console.log(`${title} ${company} ${date} ${url}`)
  }
}

function outputPlain(results: Record<string, unknown>[]): void {
  for (const r of results) {
    console.log(`title: ${r.title}`)
    console.log(`company: ${r.companyName}`)
    console.log(`address: ${r.companyAddress}`)
    console.log(`jobTypes: ${Array.isArray(r.jobTypes) ? r.jobTypes.join(", ") : "-"}`)
    console.log(`published: ${r.publishedDate}`)
    console.log(`deadline: ${r.applicationDeadline ?? "N/A"}`)
    console.log(`url: ${r.url}`)
    console.log("")
  }
}
