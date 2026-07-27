import { beforeAll, describe, expect, test } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"

interface SearchResponse {
  meta: { count: number; page: number }
  results: Array<{
    id: string
    title: string
    company: string | null
    location: string | null
    date: string | null
    dateRelative: string | null
    ageDays: number | null
    url: string
    contract: string | null
    salary: string | null
  }>
}

// These hit HelloWork live. The skill asks callers to keep volume low, so the
// suite does the same: ONE search shared by every assertion below, plus ONE
// detail lookup — two requests total, not one per test.
let search: SearchResponse
let searchExitCode: number

beforeAll(async () => {
  const result = await runCLI(["search", "-q", "developpeur", "-c", "Freelance", "-n", "5"])
  searchExitCode = result.exitCode
  search = parseJSON<SearchResponse>(result)
})

describe("search (live)", () => {
  test("exits 0 and returns results", () => {
    expect(searchExitCode).toBe(0)
    // An empty list here usually means throttling or a markup change, not "no
    // freelance dev jobs in France" — say so rather than failing on a bare 0.
    expect(
      search.results.length,
      "no results — HelloWork may be throttling, or the card markup changed (see url-reference.md)",
    ).toBeGreaterThan(0)
  })

  test("meta matches the payload and --limit is respected", () => {
    expect(search.meta.page).toBe(1)
    expect(search.meta.count).toBe(search.results.length)
    expect(search.results.length).toBeLessThanOrEqual(5)
  })

  test("every result has the contract's required fields populated", () => {
    for (const job of search.results) {
      expect(job.id).toMatch(/^\d+$/)
      expect(job.title).toBeTruthy()
      // A title that still carries markup means the card parser drifted.
      expect(job.title).not.toContain("<")
      expect(job.url).toStartWith("https://www.hellowork.com/fr-fr/emplois/")
      expect(job.url).toContain(job.id)
      // Missing values must be null, never absent.
      for (const key of ["company", "location", "date", "contract", "salary"]) {
        expect(key in job).toBe(true)
      }
    }
  })

  test("server-side contract filtering and company parsing both resolve", () => {
    expect(search.results.some((j) => j.contract !== null)).toBe(true)
    expect(search.results.filter((j) => j.company).length).toBeGreaterThan(0)
  })

  test("relative labels are converted to ISO dates", () => {
    const dated = search.results.filter((j) => j.date !== null)
    expect(
      dated.length,
      "no card date parsed — check RELATIVE_DATE_RE against the labels HelloWork now renders",
    ).toBeGreaterThan(0)
    for (const job of dated) {
      expect(job.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(job.ageDays).toBeGreaterThanOrEqual(0)
      expect(job.dateRelative).toBeTruthy()
    }
  })
})

describe("detail (live)", () => {
  test("resolves a search result into structured JSON-LD data", async () => {
    expect(search.results.length).toBeGreaterThan(0)
    const card = search.results[0]

    const result = await runCLI(["detail", card.id])
    const job = parseJSON<{
      id: string
      title: string
      contract: string | null
      url: string
      description: string | null
      skills: string[] | null
    }>(result)

    expect(result.exitCode).toBe(0)
    expect(job.id).toBe(card.id)
    expect(job.title).toBeTruthy()
    expect(job.title).not.toContain("<")
    expect(job.url).toContain(card.id)

    // htmlToText must strip markup and decode entities.
    expect(job.description).toBeTruthy()
    expect(job.description).not.toContain("<br")
    expect(job.description).not.toContain("&nbsp;")
    expect(job.description).not.toContain("&#x")

    // Regression guard: the detail page's contract must match the card's, not a
    // related-offers sidebar entry. See extractContract in helpers.ts.
    if (card.contract) expect(job.contract).toBe(card.contract)
  })
})
