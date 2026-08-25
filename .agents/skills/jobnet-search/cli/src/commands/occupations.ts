import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface OccupationAlias {
  aliasIdentifier: string
  conceptUriDa: string
  alternativeLabelDa: string
}

interface Occupation {
  conceptUriDa: string
  preferredLabelDa: string
  aliases: OccupationAlias[]
}

export const occupations = defineCommand({
  name: "occupations",
  description: "Search occupation types (for building filters)",
  options: {
    "search-string": option(z.string().optional(), {
      description: "Search term for occupation, e.g. sygeplejerske",
    }),
    "per-page": option(z.coerce.number().int().min(1).default(10), {
      description: "Max results to return",
    }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), {
      description: "Output format: json, table, plain",
    }),
  },
  handler: async ({ flags, signal }) => {
    if (signal.aborted) return

    if (!flags["search-string"]) {
      writeError("--search-string is required", "MISSING_REQUIRED")
      process.exit(1)
    }

    const params: Record<string, string> = {
      searchString: flags["search-string"],
      pageSize: String(flags["per-page"]),
    }

    try {
      const rawData = await apiFetch<Occupation[]>("/OccupationSearch", params)

      if (signal.aborted) return

      // Client-side filter — API does not enforce pageSize reliably
      const data = rawData.slice(0, flags["per-page"])

      if (flags.format === "json") {
        console.log(JSON.stringify(data, null, 2))
      } else if (flags.format === "table") {
        outputTable(data)
      } else {
        outputPlain(data)
      }
    } catch (err) {
      writeError(err instanceof Error ? err.message : String(err), "API_ERROR")
      process.exit(1)
    }
  },
})

function outputTable(data: Occupation[]): void {
  console.log("conceptUriDa                                                            preferredLabelDa")
  for (const o of data) {
    const uri = o.conceptUriDa.substring(0, 70).padEnd(70)
    const label = o.preferredLabelDa
    console.log(`${uri} ${label}`)
  }
}

function outputPlain(data: Occupation[]): void {
  for (const o of data) {
    console.log(`label: ${o.preferredLabelDa}`)
    console.log(`uri: ${o.conceptUriDa}`)
    if (o.aliases.length > 0) {
      console.log(`aliases: ${o.aliases.map((a) => a.alternativeLabelDa).join(", ")}`)
    }
    console.log("")
  }
}
