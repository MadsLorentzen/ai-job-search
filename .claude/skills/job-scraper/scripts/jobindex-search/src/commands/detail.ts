import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { htmlFetch, writeError } from "../helpers.js"

const BASE_URL = "https://www.jobindex.dk"

interface DetailResult {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  deadline: string | null
  employmentType: string | null
  hours: string | null
  applyUrl: string | null
  url: string
  description: string | null
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/**
 * Decode HTML entities in text
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/**
 * Strip HTML tags from text
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim()
}

/**
 * Extract job ID from URL or return as-is if already an ID
 */
function extractIdFromUrl(url: string): string {
  // Match IDs like h1647303, r13677312, etc.
  const match = url.match(/\/jobannonce\/([a-zA-Z]\d+)/)
  if (match) return match[1]
  return url
}

function buildUrl(idOrUrl: string): { url: string; id: string } {
  if (idOrUrl.startsWith("http")) {
    const id = extractIdFromUrl(idOrUrl)
    return { url: idOrUrl, id }
  }
  // It's a bare ID
  const url = `${BASE_URL}/jobannonce/${idOrUrl}`
  return { url, id: idOrUrl }
}

/**
 * Parse the detail HTML page using regex to avoid node-html-parser nesting bugs.
 */
function parseDetailPage(html: string, url: string, id: string): DetailResult {
  // Title: extract from <h1> tag
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = h1Match ? decodeHtmlEntities(stripTags(h1Match[1])) : ""

  if (!title) {
    throw new Error("Failed to parse job listing HTML")
  }

  // Company and companyUrl from jix-toolbar-top__company section
  let company: string | null = null
  let companyUrl: string | null = null

  const companySection = html.match(/class="jix-toolbar-top__company"[^>]*>([\s\S]*?)<\/div>/i)
  if (companySection) {
    const linkMatch = companySection[1].match(/<[Aa][^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/[Aa]>/i)
    if (linkMatch) {
      company = decodeHtmlEntities(stripTags(linkMatch[2])) || null
      companyUrl = linkMatch[1] || null
    }
  }

  // Location from jix_robotjob--area span
  let location: string | null = null
  const locMatch = html.match(/<span[^>]+class="jix_robotjob--area"[^>]*>([\s\S]*?)<\/span>/i)
  if (locMatch) {
    location = decodeHtmlEntities(stripTags(locMatch[1])) || null
  }

  // Date from <time datetime="..."> element
  let date: string | null = null
  const timeMatch = html.match(/<time[^>]+datetime="([^"]+)"/)
  if (timeMatch) {
    date = timeMatch[1] || null
  }

  // Employment type and hours from jix-info section
  let employmentType: string | null = null
  let hours: string | null = null
  let deadline: string | null = null

  const jixInfoMatch = html.match(/class="jix-info"[^>]*>([\s\S]*?)<\/div>/i)
  if (jixInfoMatch) {
    const jixInfoHtml = jixInfoMatch[1]

    // Parse p elements with bold labels
    const pMatches = [...jixInfoHtml.matchAll(/<p[^>]*><b>([^<]+)<\/b>\s*([\s\S]*?)<\/p>/gi)]
    for (const pm of pMatches) {
      const label = pm[1].toLowerCase().trim()
      const value = stripTags(pm[2]).trim()

      if (label.includes("ansættelsestype") || label.includes("employment type")) {
        employmentType = decodeHtmlEntities(value) || null
      } else if (label.includes("ugentlig arbejdstid") || label.includes("weekly working time") || label.includes("arbejdstid")) {
        hours = decodeHtmlEntities(value) || null
      } else if (label.includes("ansøgningsfrist") || label.includes("deadline") || label.includes("application deadline")) {
        deadline = decodeHtmlEntities(value) || null
      }
    }
  }

  // If not found in jix-info, try broader text patterns
  if (!employmentType) {
    const emtMatch = html.match(/<b>(?:Ansættelsestype|Employment\s*type):<\/b>\s*([^<\n]+)/i)
    if (emtMatch) {
      employmentType = decodeHtmlEntities(emtMatch[1].trim()) || null
    }
  }

  if (!hours) {
    const hoursMatch = html.match(/<b>(?:Ugentlig\s*arbejdstid|Weekly\s*working\s*time):<\/b>\s*([^<\n]+)/i)
    if (hoursMatch) {
      hours = decodeHtmlEntities(hoursMatch[1].trim()) || null
    }
  }

  // Deadline from application section
  if (!deadline) {
    // Look for "senest den" or "Ansøgningsfrist" patterns in text
    const deadlineMatch = html.match(/Ansøgningsfrist[^:]*:\s*([^<\n,]+)/i)
    if (deadlineMatch) {
      deadline = decodeHtmlEntities(deadlineMatch[1].trim()) || null
    }
  }

  // Apply URL: look for /c?t= redirect links in jix_onlineapplication_button
  let applyUrl: string | null = null
  const applySection = html.match(/class="jix_onlineapplication_button"[^>]*>[\s\S]*?href="([^"]+)"/i)
  if (applySection) {
    const href = decodeHtmlEntities(applySection[1])
    applyUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`
  }

  // If not found, look for any /c?t= link
  if (!applyUrl) {
    const ctMatch = html.match(/href="(\/c\?t=[^"]+)"/)
    if (ctMatch) {
      applyUrl = `${BASE_URL}${decodeHtmlEntities(ctMatch[1])}`
    }
  }

  // Description: job text section
  let description: string | null = null

  // Try job-text class first
  const jobTextMatch = html.match(/class="job-text"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/div>)/i)
  if (jobTextMatch) {
    description = decodeHtmlEntities(stripTags(jobTextMatch[1])).replace(/\s+/g, " ").trim() || null
  }

  // Fallback: try og:description meta tag for a brief description
  if (!description) {
    const ogDescMatch = html.match(/property="og:description"[^>]+content="([^"]+)"/i) ||
                        html.match(/content="([^"]+)"[^>]+property="og:description"/i)
    if (ogDescMatch) {
      description = decodeHtmlEntities(ogDescMatch[1]) || null
    }
  }

  // Get canonical URL or use the fetched URL
  const canonicalMatch = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) ||
                         html.match(/property="og:url"[^>]+content="([^"]+)"/i) ||
                         html.match(/content="([^"]+)"[^>]+property="og:url"/i)
  const canonicalUrl = canonicalMatch ? canonicalMatch[1] : url

  // Extract ID from canonical URL, fall back to the provided ID
  const canonicalId = extractIdFromUrl(canonicalUrl) || id

  return {
    id: canonicalId,
    title,
    company: company || null,
    companyUrl: companyUrl || null,
    location: location || null,
    date: date || null,
    deadline: deadline || null,
    employmentType: employmentType || null,
    hours: hours || null,
    applyUrl: applyUrl || null,
    url: canonicalUrl,
    description: description || null,
  }
}

export const detail = defineCommand({
  name: "detail",
  description: "Fetch full job listing detail by ID or URL",
  options: {
    format: option(z.enum(["json", "plain"]).default("json"), {
      description: "Output format: json, plain",
    }),
  },
  handler: async ({ positional, flags, signal }) => {
    if (signal.aborted) return

    const idArg = positional[0]
    if (!idArg) {
      writeError("Job ID or URL is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const { url, id } = buildUrl(idArg)

    try {
      const html = await htmlFetch(url)

      if (signal.aborted) return

      // Check if page is not a valid job listing
      // A valid job listing has an <h1> tag
      if (!html.includes("<h1>") && !html.includes("<h1 ")) {
        writeError("Job not found", "NOT_FOUND")
        process.exit(1)
      }

      let data: DetailResult
      try {
        data = parseDetailPage(html, url, id)
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
        writeError(msg, "PARSE_ERROR")
        process.exit(1)
      }

      // Verify it's a valid job page (has a title)
      if (!data.title) {
        writeError("Failed to parse job listing HTML", "PARSE_ERROR")
        process.exit(1)
      }

      if (flags.format === "json") {
        console.log(JSON.stringify(data, null, 2))
      } else {
        outputPlain(data)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("Job not found") || message.includes("404") || message.includes("NOT_FOUND")) {
        writeError("Job not found", "NOT_FOUND")
      } else if (message.includes("Failed to parse") || message.includes("PARSE_ERROR")) {
        writeError(message, "PARSE_ERROR")
      } else {
        writeError(message, "API_ERROR")
      }
      process.exit(1)
    }
  },
})

function outputPlain(data: DetailResult): void {
  console.log(`id: ${data.id}`)
  console.log(`title: ${data.title}`)
  console.log(`company: ${data.company ?? "-"}`)
  console.log(`location: ${data.location ?? "-"}`)
  console.log(`date: ${data.date ?? "-"}`)
  console.log(`deadline: ${data.deadline ?? "-"}`)
  console.log(`employmentType: ${data.employmentType ?? "-"}`)
  console.log(`hours: ${data.hours ?? "-"}`)
  console.log(`applyUrl: ${data.applyUrl ?? "-"}`)
  console.log(`url: ${data.url}`)
  console.log("")
  if (data.description) {
    console.log(data.description)
  }
}
