#!/usr/bin/env bun
// Regenerates job_scraper/seen_jobs.csv from job_scraper/seen_jobs.json.
// Run by /scrape (end of Step 4) and /rank (end of Step 4) so the CSV never
// drifts out of sync with the JSON — see those skills for the call site.
//
// Columns: Rank Score, Verdict, Job Title, Company, Location Context,
// Language Gate, Visa Flag / Status, Portal Source, First Seen Date, Source URL.

const JSON_PATH = new URL("./seen_jobs.json", import.meta.url)
const CSV_PATH = new URL("./seen_jobs.csv", import.meta.url)

const HEADER = [
  "Rank Score",
  "Verdict",
  "Job Title",
  "Company",
  "Location Context",
  "Language Gate",
  "Visa Flag / Status",
  "Portal Source",
  "First Seen Date",
  "Source URL",
]

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value)
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

/**
 * Market inference is deliberately based on `location_text`, not the `portal` field —
 * a portal like linkedin-search or freehire-search covers BOTH the UK and Germany, so
 * keying visa logic off portal name alone would mislabel every de.linkedin.com posting
 * with the UK sponsorship warning. location_text (e.g. "Berlin, Germany", "London, UK")
 * is the actual signal.
 */
function inferMarket(locationText) {
  if (!locationText) return null
  const t = locationText.toLowerCase()
  if (t.includes("germany") || t.includes("deutschland")) return "DE"
  if (t.includes("uk") || t.includes("united kingdom") || t.includes("england") || t.includes("scotland")) return "UK"
  return null
}

function visaFlagStatus(entry) {
  if (entry.status === "expired") return `EXPIRED — ${entry.gaps?.[0] ?? "posting unretrievable"}`
  if (entry.status !== "ranked") return "Not yet ranked"

  const market = inferMarket(entry.location_text)
  const gate = entry.location // "PASS" | "FAIL" | "FLAG"

  if (market === "DE") return "PASS (Independent relocation)"
  if (market === "UK") {
    if (gate === "FLAG") return "FLAG: Verify Active UK Sponsor Licence (check your own visa timeline)"
    if (gate === "FAIL") {
      const reason = (entry.gaps?.find((g) => /sponsor|relocat|commut/i.test(g)) ?? "Sponsorship/commute not viable")
        .replace(/^location fail:\s*/i, "")
      return `FAIL: ${reason}`
    }
    if (gate === "PASS") return "PASS: UK sponsorship confirmed in posting"
  }
  // Market couldn't be inferred (no location_text yet, e.g. pre-dates this field) — report the
  // raw gate rather than guessing a market.
  return gate ? `${gate} (market unconfirmed — see location_text)` : "Unknown"
}

async function main() {
  const data = JSON.parse(await Bun.file(JSON_PATH).text())
  const rows = [HEADER]

  for (const entry of Object.values(data.seen)) {
    rows.push([
      entry.rank_score ?? "",
      entry.rank_verdict ?? "",
      entry.title ?? "",
      entry.company ?? "",
      entry.location_text ?? "(unrecorded)",
      entry.language_gate ?? "",
      visaFlagStatus(entry),
      entry.portal ?? "",
      entry.first_seen ?? "",
      entry.url ?? "",
    ])
  }

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n"
  await Bun.write(CSV_PATH, csv)
  console.log(`Wrote ${rows.length - 1} rows to ${CSV_PATH.pathname.replace(/^\//, "")}`)
}

main()
