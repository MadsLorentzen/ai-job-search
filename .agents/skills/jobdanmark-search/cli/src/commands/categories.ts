import { defineCommand, option } from "@bunli/core"
import { z } from "zod"
import { apiFetch, writeError } from "../helpers.js"

interface Category {
  id: number
  title: string
  helpText: string
  count: number
}

export const categories = defineCommand({
  name: "categories",
  description: "List all job categories with live counts",
  options: {
    limit: option(z.coerce.number().int().min(1).optional(), {
      description: "Cap number of categories returned",
    }),
    format: option(z.enum(["json", "table", "plain"]).default("json"), {
      description: "Output format: json, table, plain",
    }),
  },
  handler: async ({ flags, signal }) => {
    if (signal.aborted) return

    try {
      let data = await apiFetch<Category[]>("/api/categorycount/getcounts")

      if (signal.aborted) return

      if (flags.limit !== undefined) {
        data = data.slice(0, flags.limit)
      }

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

function outputTable(data: Category[]): void {
  console.log("id        title                                            count")
  for (const cat of data) {
    const id = String(cat.id).padEnd(9)
    const title = cat.title.substring(0, 48).padEnd(48)
    const count = String(cat.count)
    console.log(`${id} ${title} ${count}`)
  }
}

function outputPlain(data: Category[]): void {
  for (const cat of data) {
    console.log(`id: ${cat.id}`)
    console.log(`title: ${cat.title}`)
    console.log(`helpText: ${cat.helpText}`)
    console.log(`count: ${cat.count}`)
    console.log("")
  }
}
