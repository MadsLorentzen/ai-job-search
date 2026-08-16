import { test, expect } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"

interface SearchResult {
  meta: { count: number; page: number }
  results: Array<{
    id: string
    title: string
    company: string | null
    location: string | null
    date: string | null
    url: string
    experience: string | null
  }>
}

test("search returns real results with populated id/title/url", async () => {
  const res = await runCLI(["search", "-q", "data analyst", "--limit", "5"])
  expect(res.exitCode).toBe(0)
  const data = parseJSON<SearchResult>(res)
  expect(data.results.length).toBeGreaterThan(0)
  for (const job of data.results) {
    expect(job.id).toBeTruthy()
    expect(job.title).toBeTruthy()
    expect(job.url).toContain("hirist")
  }
})

test("location filter resolves a city name", async () => {
  const res = await runCLI(["search", "-q", "data analyst", "-l", "Bangalore", "--limit", "5"])
  expect(res.exitCode).toBe(0)
  const data = parseJSON<SearchResult>(res)
  expect(data.results.length).toBeGreaterThan(0)
  const anyBangalore = data.results.some((j) => (j.location || "").includes("Bangalore"))
  expect(anyBangalore).toBe(true)
})

test("search with no query exits 1 with JSON error on stderr", async () => {
  const res = await runCLI(["search"])
  expect(res.exitCode).toBe(1)
  expect(res.stdout).toBe("")
  const err = JSON.parse(res.stderr)
  expect(err.code).toBe("NO_QUERY")
})

test("unknown location exits 1 with BAD_LOCATION", async () => {
  const res = await runCLI(["search", "-q", "data analyst", "-l", "Atlantis"])
  expect(res.exitCode).toBe(1)
  const err = JSON.parse(res.stderr)
  expect(err.code).toBe("BAD_LOCATION")
})

test("bad numeric flag exits 1 with BAD_ARG", async () => {
  const res = await runCLI(["search", "-q", "data analyst", "--page", "abc"])
  expect(res.exitCode).toBe(1)
  const err = JSON.parse(res.stderr)
  expect(err.code).toBe("BAD_ARG")
})

test("detail returns a readable description for a search result", async () => {
  const search = await runCLI(["search", "-q", "data analyst", "--limit", "3"])
  const data = parseJSON<SearchResult>(search)
  const id = data.results[0]?.id
  expect(id).toBeTruthy()
  const res = await runCLI(["detail", id!, "--format", "plain"])
  expect(res.exitCode).toBe(0)
  expect(res.stdout.length).toBeGreaterThan(40)
  expect(res.stdout).not.toContain("</p>")
  expect(res.stdout).not.toContain("<div")
})
