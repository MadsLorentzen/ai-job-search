import { loadRegistry, writeError } from "../helpers.js"

export interface ListOpts {
  format: "json" | "table" | "plain"
}

export async function runList(opts: ListOpts): Promise<number> {
  try {
    const registry = await loadRegistry()
    if (opts.format === "table") {
      const header = "NAME".padEnd(28) + "ATS".padEnd(16) + "ATS_ID".padEnd(20) + "LOCATIONS_FILTER"
      const rows = registry.map(
        (e) =>
          e.name.slice(0, 27).padEnd(28) +
          e.ats.padEnd(16) +
          (e.ats_id || "—").slice(0, 19).padEnd(20) +
          (e.locations_filter?.join(", ") || "—"),
      )
      process.stdout.write([header, "-".repeat(header.length), ...rows].join("\n") + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        registry.map((e) => `${e.name} — ${e.ats}${e.ats_id ? ":" + e.ats_id : ""} — ${e.careers_url}`).join("\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify({ meta: { count: registry.length }, results: registry }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "LIST_FAILED")
    return 1
  }
}
