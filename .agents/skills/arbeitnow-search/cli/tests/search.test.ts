import { describe, expect, test } from "bun:test"
import { runCLI, parseJSON } from "./helpers"

interface SearchResult {
  meta: { count: number; page: number; scanned: number }
  results: Array<{ id: string | null; title: string | null; url: string | null }>
}

describe("search (live)", () => {
  test("returns at least one result with id/title/url", async () => {
    const result = await runCLI(["search", "--limit", "3"])
    expect(result.exitCode).toBe(0)
    const data = parseJSON<SearchResult>(result)
    expect(data.results.length).toBeGreaterThan(0)
    for (const job of data.results) {
      expect(job.id).toBeTruthy()
      expect(job.title).toBeTruthy()
      expect(job.url).toContain("arbeitnow.com")
    }
  })

  test("detail returns readable content for a search hit", async () => {
    const search = await runCLI(["search", "--limit", "1"])
    const data = parseJSON<SearchResult>(search)
    expect(data.results.length).toBe(1)
    const detail = await runCLI(["detail", data.results[0].id as string, "--format", "plain"])
    expect(detail.exitCode).toBe(0)
    expect(detail.stdout.length).toBeGreaterThan(50)
  })
})
