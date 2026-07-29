import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers.js"

interface SearchResponse {
  meta: { count: number; page: number }
  results: Array<{
    id: string
    title: string
    company: string | null
    location: string | null
    date: string | null
    url: string
  }>
}

// Live smoke tests. They hit the real portal, so they stay to a handful of
// requests and assert on shape rather than on any specific mission.
describe("live search", () => {
  test("returns real missions with the contract's required fields", async () => {
    const res = await runCLI(["search", "-q", "Java", "-n", "5"])
    const json = parseJSON<SearchResponse>(res)

    expect(json.results.length).toBeGreaterThan(0)
    expect(json.meta.page).toBe(1)
    for (const r of json.results) {
      expect(r.id).toMatch(/^\d{6}[A-Z]\d{3}$/)
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.url).toStartWith("https://www.freelance-informatique.fr/mission-")
      // Every contract field must be present, even when null.
      expect(r).toHaveProperty("company")
      expect(r).toHaveProperty("location")
      expect(r).toHaveProperty("date")
    }
  })

  test("warns on stderr when the portal substitutes a related skill", async () => {
    // "Rust" is outside the portal's taxonomy: it answers with C++ missions
    // rather than nothing, which is the trap this warning exists to catch.
    const res = await runCLI(["search", "-q", "Rust", "--format", "table"])
    expect(res.exitCode).toBe(0)
    expect(JSON.parse(res.stderr)).toMatchObject({ code: "QUERY_SUBSTITUTED" })
    expect(res.stdout).not.toBe("No results.")
  })

  test("--strict drops the substituted results", async () => {
    const res = await runCLI(["search", "-q", "Rust", "--strict", "--format", "table"])
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe("No results.")
  })

  test("a real taxonomy term reports skill hits and warns about nothing", async () => {
    const res = await runCLI(["search", "-q", "Kubernetes", "-n", "3"])
    const json = parseJSON<SearchResponse & { meta: { querySkillHits: number } }>(res)
    expect(json.meta.querySkillHits).toBeGreaterThan(0)
    expect(res.stderr).toBe("")
  })

  test("detail resolves a reference taken from search", async () => {
    const search = parseJSON<SearchResponse>(await runCLI(["search", "-q", "Java", "-n", "1"]))
    const ref = search.results[0].id

    const res = await runCLI(["detail", ref])
    const mission = parseJSON<{ id: string; title: string; description: string | null }>(res)

    expect(mission.id).toBe(ref)
    expect(mission.title.length).toBeGreaterThan(0)
    expect(mission.description).not.toBeNull()
    expect(mission.description).not.toContain("<")
  })
})

describe("error handling", () => {
  test("a non-numeric --limit exits 1 with a JSON error on stderr", async () => {
    const res = await runCLI(["search", "-q", "Java", "-n", "abc"])
    expect(res.exitCode).toBe(1)
    expect(res.stdout).toBe("")
    expect(JSON.parse(res.stderr)).toMatchObject({ code: "BAD_ARG" })
  })

  test("detail without an argument exits 1", async () => {
    const res = await runCLI(["detail"])
    expect(res.exitCode).toBe(1)
    expect(JSON.parse(res.stderr)).toMatchObject({ code: "NO_ID" })
  })

  test("an unparseable reference exits 1 with BAD_ID", async () => {
    const res = await runCLI(["detail", "not-a-mission"])
    expect(res.exitCode).toBe(1)
    expect(JSON.parse(res.stderr)).toMatchObject({ code: "BAD_ID" })
  })

  test("a well-formed but nonexistent reference exits 1 with NOT_FOUND", async () => {
    const res = await runCLI(["detail", "999999Z999"])
    expect(res.exitCode).toBe(1)
    expect(JSON.parse(res.stderr)).toMatchObject({ code: "NOT_FOUND" })
  })

  test("an unknown command exits 1", async () => {
    const res = await runCLI(["frobnicate"])
    expect(res.exitCode).toBe(1)
    expect(JSON.parse(res.stderr)).toMatchObject({ code: "BAD_CMD" })
  })
})
