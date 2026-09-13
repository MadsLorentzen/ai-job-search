import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface AutocompleteItem {
  id: string
  // Nullable because apiFetch casts the JSON body with no runtime validation:
  // an item missing its text arrives typed as if it had one, and the filter
  // below is the only place the command derefs it (#421). A null text can
  // never match the required non-empty query, so such an item is filtered
  // out here and downstream output never sees it.
  text: string | null
  value: number
  category: string
  slug: string
}

interface AutocompleteGroup {
  title: string
  items: AutocompleteItem[]
}

/**
 * Filter the API's autocomplete groups to items whose text matches the query
 * (the API always returns all categories, so a nonsense query must yield []).
 * Exported for tests.
 */
export function filterAutocompleteGroups(raw: AutocompleteGroup[], query: string): AutocompleteGroup[] {
  const queryLower = query.toLowerCase()
  return raw
    .map((g) => ({
      title: g.title,
      items: (g.items ?? []).filter(
        (item) => typeof item.text === "string" && item.text.toLowerCase().includes(queryLower),
      ),
    }))
    .filter((g) => g.items.length > 0)
}

export const autocomplete = defineCommand({
  name: "autocomplete",
  description: "Suggest job titles and categories for a query",
  options: {
    query: option(z.string().optional(), {
      description: "Search text to autocomplete (required)",
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
      const raw = await apiFetch<AutocompleteGroup[]>("/api/search/autocomplete", {
        q: flags.query,
      })

      if (signal.aborted) return

      const filtered = filterAutocompleteGroups(raw, flags.query)

      let result = filtered

      if (flags.limit !== undefined) {
        // Apply limit across all groups, distributing across groups
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

function outputTable(data: AutocompleteGroup[]): void {
  console.log("category   id                    text                              value  slug")
  for (const group of data) {
    for (const item of group.items) {
      const cat = item.category.padEnd(10)
      const id = item.id.substring(0, 20).padEnd(20)
      const text = (item.text ?? "").substring(0, 32).padEnd(32)
      const value = String(item.value).padEnd(6)
      const slug = item.slug
      console.log(`${cat} ${id} ${text} ${value} ${slug}`)
    }
  }
}

function outputPlain(data: AutocompleteGroup[]): void {
  for (const group of data) {
    console.log(`=== ${group.title} ===`)
    for (const item of group.items) {
      console.log(`  ${item.text ?? ""} (${item.category}, id=${item.value}, slug=${item.slug})`)
    }
  }
}
