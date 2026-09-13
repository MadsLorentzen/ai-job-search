import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

export const suggestions = defineCommand({
  name: "suggestions",
  description: "Typeahead suggestions for job title / keyword search",
  options: {
    query: option(z.string().optional(), {
      description: "Partial search string to complete",
    }),
    limit: option(z.coerce.number().int().min(1).optional(), {
      description: "Cap number of suggestions returned",
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

    const params: Record<string, string> = {
      query: flags.query,
    }

    try {
      const data = await apiFetch<string[]>("/FindJob/GetTypeaheadSuggestions", params)

      if (signal.aborted) return

      let results = data
      if (flags.limit !== undefined) {
        results = results.slice(0, flags.limit)
      }

      if (flags.format === "json") {
        console.log(JSON.stringify(results, null, 2))
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

function outputTable(data: string[]): void {
  console.log("suggestion")
  for (const s of data) {
    console.log(s)
  }
}

function outputPlain(data: string[]): void {
  for (const s of data) {
    console.log(s)
  }
}
