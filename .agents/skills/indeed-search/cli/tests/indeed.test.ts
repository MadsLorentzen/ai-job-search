import { afterEach, describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"
import { dedupe, filterByAge, postedDate, readToken, runActor, searchUrl, toResult } from "../src/helpers"
import { buildInput } from "../src/commands/search"

// Offline: items shaped like the actor's documented output. No run is started,
// so these tests never spend Apify credit.
const ITEM = {
  id: "abc123",
  positionName: "Data Engineer",
  company: "Example Ltd",
  location: "Dublin, County Dublin",
  salary: "€55,000 - €65,000 a year",
  jobType: ["Full-time", "Permanent"],
  url: "https://ie.indeed.com/viewjob?jk=abc123",
  externalApplyLink: "https://example.ie/careers/1",
  postedAt: "3 days ago",
  scrapedAt: "2026-10-15T10:00:00.000Z",
  isExpired: false,
  description: "Build pipelines.",
}

describe("toResult", () => {
  test("maps the contract fields and keeps the employer apply link", () => {
    const r = toResult(ITEM)!
    expect(r).toMatchObject({ id: "abc123", title: "Data Engineer", company: "Example Ltd", date: "2026-10-12" })
    expect(r.applyUrl).toBe("https://example.ie/careers/1")
    expect(r.jobType).toBe("Full-time, Permanent")
  })

  test("the actor's no-results error item is dropped", () => {
    expect(toResult({ error: "FOUND_NO_RESULTS", errorDescription: "none" })).toBeNull()
  })

  test("missing values are null, never omitted", () => {
    const r = toResult({ id: "x", positionName: "QA" })!
    for (const k of ["company", "location", "date", "url"]) expect((r as unknown as Record<string, unknown>)[k]).toBeNull()
  })
})

describe("postedDate", () => {
  const at = "2026-10-15T10:00:00.000Z"
  test("prefers the parsed ISO date", () => {
    expect(postedDate({ postingDateParsed: "2026-10-11T00:00:00.000Z", postedAt: "1 day ago" })).toBe("2026-10-11")
  })
  test("counts relative labels back from scrapedAt", () => {
    expect(postedDate({ postedAt: "Just posted", scrapedAt: at })).toBe("2026-10-15")
    expect(postedDate({ postedAt: "Today", scrapedAt: at })).toBe("2026-10-15")
    expect(postedDate({ postedAt: "1 day ago", scrapedAt: at })).toBe("2026-10-14")
  })
  test("30+ days has no exact date and is not guessed", () => {
    expect(postedDate({ postedAt: "30+ days ago", scrapedAt: at })).toBeNull()
  })
})

describe("window and dedupe", () => {
  test("filterByAge trims to N days and keeps undated rows", () => {
    const rows = [toResult({ ...ITEM, id: "a", postedAt: "2 days ago" })!, toResult({ ...ITEM, id: "b", postedAt: "20 days ago" })!, toResult({ ...ITEM, id: "c", postedAt: "30+ days ago" })!]
    expect(filterByAge(rows, 7, new Date("2026-10-15T12:00:00Z")).map((r) => r.id)).toEqual(["a", "c"])
  })
  test("dedupe keeps the first copy of a posting", () => {
    expect(dedupe([toResult(ITEM)!, toResult(ITEM)!])).toHaveLength(1)
  })
})

describe("input building", () => {
  test("each query becomes an ie.indeed.com search URL with fromage", () => {
    const u = new URL(searchUrl("data engineer", "Dublin", "ie", 7))
    expect(u.host).toBe("ie.indeed.com")
    expect(u.searchParams.get("q")).toBe('title:"data engineer"')
    expect(new URL(searchUrl("data engineer", "Dublin", "ie", 7, true)).searchParams.get("q")).toBe("data engineer")
    expect(u.searchParams.get("l")).toBe("Dublin")
    expect(u.searchParams.get("fromage")).toBe("7")
  })
  test("several queries share one actor input", () => {
    const input = buildInput({ queries: ["a", "b"], location: "Dublin", country: "ie", jobage: 7, limit: 15, maxCharge: 1, withDescription: true, broad: false, format: "json" })
    expect((input.startUrls as unknown[]).length).toBe(2)
    expect(input.maxItemsPerSearch).toBe(15)
  })
  test("a missing token names the variable", () => {
    expect(() => readToken({})).toThrow("APIFY_API_TOKEN")
  })
})

describe("CLI contract (offline)", () => {
  test("unknown flag exits 1 with JSON on stderr", async () => {
    const r = await runCLI(["search", "-q", "qa", "--bogus", "1"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("UNKNOWN_FLAG")
  })
  test("missing query exits 1", async () => {
    const r = await runCLI(["search", "-l", "Dublin"])
    expect(JSON.parse(r.stderr).code).toBe("NO_QUERY")
  })
  test("limit above the cap is refused before any run", async () => {
    const r = await runCLI(["search", "-q", "qa", "-n", "500"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG")
  })
})

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("runActor", () => {
  test("sends the spend cap and returns the dataset", async () => {
    let seen = ""
    globalThis.fetch = (async (url: string) => {
      seen = url
      return Response.json([ITEM])
    }) as unknown as typeof fetch
    const items = await runActor({}, "t", 0.5)
    expect(items).toHaveLength(1)
    expect(seen).toContain("maxTotalChargeUsd=0.5")
  })
  test("no credit left is QUOTA_EXCEEDED, not a retry", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("payment required", { status: 402 })
    }) as unknown as typeof fetch
    await expect(runActor({}, "t", 1)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" })
    expect(calls).toBe(1)
  })
})

// Live smoke test: opt-in, because every run is billed.
const live = process.env.APIFY_API_TOKEN && process.env.INDEED_LIVE_TEST === "1"
describe.skipIf(!live)("live search (INDEED_LIVE_TEST=1)", () => {
  test("returns at least one Dublin result", async () => {
    const r = await runCLI(["search", "-q", "data engineer", "-l", "Dublin", "--jobage", "7", "-n", "5", "--max-charge", "0.10"])
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).results.length).toBeGreaterThan(0)
  })
})
