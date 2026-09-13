import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface LocationItem {
  id: string
  text: string
  value: string
  category: string
  slug: string
}

interface LocationGroup {
  title: string
  items: LocationItem[]
}

export const locations = defineCommand({
  name: "locations",
  description: "Suggest municipalities, zip codes, and regions for a query",
  options: {
    query: option(z.string().optional(), {
      description: "Location text to search (city, zip code, region) (required)",
    }),
    limit: option(z.coerce.number().int().min(1).optional(), {
      description: "Cap total suggestions returned",
    }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), {
      description: "Output format: json, table, plain",
    }),
  },
  handler: async ({ flags, signal }) => {
    if (signal.aborted) return

    if (!flags.query) {
      writeError("--query is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    try {
      const raw = await apiFetch<LocationGroup[]>("/api/search/locations", {
        q: flags.query,
      })

      if (signal.aborted) return

      // Filter out groups with no items
      const filtered = raw.filter((g) => g.items && g.items.length > 0)

      let result = filtered

      if (flags.limit !== undefined) {
        // Apply limit across all groups
        let remaining = flags.limit
        result = []
        for (const group of filtered) {
          if (remaining <= 0) break
          const items = group.items.slice(0, remaining)
          remaining -= items.length
          if (items.length > 0) {
            result.push({ title: group.title, items })
          }
        }
      }

      if (flags.format === "json") {
        console.log(JSON.stringify(result, null, 2))
      } else if (flags.format === "table") {
        outputTable(result)
      } else {
        outputPlain(result)
      }
    } catch (err) {
      writeError(err instanceof Error ? err.message : String(err), "API_ERROR")
      process.exit(1)
    }
  },
})

function outputTable(data: LocationGroup[]): void {
  console.log("category     id                      text                          value       slug")
  for (const group of data) {
    for (const item of group.items) {
      const cat = item.category.padEnd(12)
      const id = item.id.substring(0, 22).padEnd(22)
      const text = item.text.substring(0, 28).padEnd(28)
      const value = String(item.value).padEnd(11)
      const slug = item.slug
      console.log(`${cat} ${id} ${text} ${value} ${slug}`)
    }
  }
}

function outputPlain(data: LocationGroup[]): void {
  for (const group of data) {
    console.log(`=== ${group.title} ===`)
    for (const item of group.items) {
      console.log(`  ${item.text} (${item.category}, value=${item.value}, slug=${item.slug})`)
    }
  }
}
