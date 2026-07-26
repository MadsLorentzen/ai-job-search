import { describe, expect, test } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"

interface SearchResponse {
  meta: { count: number; page: number }
  results: Array<{
    id: string
    slug: string | null
    title: string
    company: string | null
    location: string | null
    date: string | null
    url: string
    contracts: string[]
    dailyRate: string | null
  }>
}

// Live smoke tests. They hit Free-Work's public API, so they need network
// access and depend on the board actually having freelance backend missions.
describe("search (live)", () => {
  test("returns well-formed results for a freelance backend query", async () => {
    const r = await runCLI(["search", "-q", "backend", "-c", "contractor", "-n", "5"])
    const data = parseJSON<SearchResponse>(r)

    expect(data.meta.page).toBe(1)
    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results.length).toBeLessThanOrEqual(5)
    expect(data.meta.count).toBe(data.results.length)

    for (const job of data.results) {
      expect(job.id).toMatch(/^\d+$/)
      expect(job.title.length).toBeGreaterThan(0)
      expect(job.url).toStartWith("https://www.free-work.com/")
      // Contract-required keys are present even when the value is unknown.
      expect(job).toHaveProperty("company")
      expect(job).toHaveProperty("location")
      expect(job).toHaveProperty("date")
      expect(job).toHaveProperty("slug")
    }
  })

  test("--contract contractor only returns freelance-eligible missions", async () => {
    const r = await runCLI(["search", "-q", "developpeur", "-c", "contractor", "-n", "10"])
    const data = parseJSON<SearchResponse>(r)
    expect(data.results.length).toBeGreaterThan(0)
    for (const job of data.results) {
      expect(job.contracts).toContain("contractor")
    }
  })

  test("--limit caps the result count", async () => {
    const r = await runCLI(["search", "-q", "java", "-c", "contractor", "-n", "3"])
    expect(parseJSON<SearchResponse>(r).results.length).toBeLessThanOrEqual(3)
  })

  test("--location narrows to the requested region", async () => {
    const r = await runCLI([
      "search",
      "-q",
      "developpeur",
      "-c",
      "contractor",
      "-l",
      "Ile-de-France",
      "-n",
      "10",
    ])
    const data = parseJSON<SearchResponse>(r)
    expect(data.results.length).toBeGreaterThan(0)
    // Region filtering is server-side; every hit should sit in Île-de-France.
    const outside = data.results.filter(
      (j) => j.location && !/Île-de-France|Ile-de-France|Paris|\(7[578]\)|\(9[1-5]\)/i.test(j.location),
    )
    expect(outside).toEqual([])
  })

  test("table format renders a header row", async () => {
    const r = await runCLI(["search", "-q", "backend", "-c", "contractor", "-n", "3", "--format", "table"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("TITLE")
    expect(r.stdout).toContain("TJM")
  })
})

describe("detail (live)", () => {
  test("resolves a slug taken from a search result", async () => {
    const s = await runCLI(["search", "-q", "backend", "-c", "contractor", "-n", "1"])
    const slug = parseJSON<SearchResponse>(s).results[0]?.slug
    expect(slug).toBeTruthy()

    const r = await runCLI(["detail", slug as string, "--format", "plain"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Company:")
    expect(r.stdout).toContain("URL:")
    // Description must be readable text, not markup.
    expect(r.stdout).not.toContain("<p>")
    expect(r.stdout).not.toContain("&#")
  })

  test("a nonexistent slug exits 1 with NOT_FOUND", async () => {
    const r = await runCLI(["detail", "definitely-not-a-real-posting-slug-xyzzy"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NOT_FOUND")
  })
})
