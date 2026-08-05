// Offline tests over pure functions — no network.
import { describe, expect, test } from "bun:test"
import {
  normalizeJob,
  parseJobs,
  matchesQuery,
  matchesLocation,
  withinJobAge,
  parseBoards,
  htmlToText,
  decodeHtmlEntities,
  type RawGreenhouseJob,
} from "../src/helpers.js"
import { parseRef, buildDetail } from "../src/commands/detail.js"

const FIXTURE: RawGreenhouseJob = {
  id: 8089353,
  internal_job_id: 3478585,
  title: "Software Engineer, Vulnerability Management",
  company_name: "Stripe",
  location: { name: "US - Remote" },
  first_published: "2026-08-01T20:01:19-04:00",
  updated_at: "2026-08-04T20:01:19-04:00",
  absolute_url: "https://stripe.com/jobs/search?gh_jid=8089353",
  requisition_id: "REQ-123",
  // Greenhouse double-escapes: `content` is an HTML-escaped HTML string.
  content: "&lt;p&gt;About &amp;amp; more&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Ship code&lt;/li&gt;&lt;/ul&gt;",
  departments: [{ name: "Security Analytics" }],
  offices: [{ name: "US" }],
}

describe("normalizeJob", () => {
  test("maps the documented field paths onto the contract shape", () => {
    const c = normalizeJob(FIXTURE, "stripe")!
    expect(c.id).toBe("8089353")
    expect(c.title).toBe("Software Engineer, Vulnerability Management")
    expect(c.company).toBe("Stripe")
    expect(c.location).toBe("US - Remote")
    expect(c.url).toBe("https://stripe.com/jobs/search?gh_jid=8089353")
    expect(c.board).toBe("stripe")
    expect(c.requisitionId).toBe("REQ-123")
  })

  test("prefers first_published over updated_at for the posting date", () => {
    expect(normalizeJob(FIXTURE, "stripe")!.date).toBe("2026-08-01T20:01:19-04:00")
    const noPub = normalizeJob({ ...FIXTURE, first_published: undefined }, "stripe")!
    expect(noPub.date).toBe("2026-08-04T20:01:19-04:00")
  })

  test("contract fields are null, never omitted", () => {
    const c = normalizeJob({ id: 1, title: "Bare" }, "acme")!
    expect(c.location).toBeNull()
    expect(c.date).toBeNull()
    expect(c.requisitionId).toBeNull()
    expect(c.company).toBe("acme") // falls back to the board token
    expect(c.url).toBe("https://boards.greenhouse.io/acme/jobs/1")
  })

  test("rejects records with no usable id or title", () => {
    expect(normalizeJob({ title: "no id" }, "b")).toBeNull()
    expect(normalizeJob({ id: 5 }, "b")).toBeNull()
    expect(normalizeJob(null as unknown as RawGreenhouseJob, "b")).toBeNull()
  })
})

describe("parseJobs", () => {
  test("one malformed record cannot break the rest of the board", () => {
    const cards = parseJobs({ jobs: [FIXTURE, { title: "broken" }, { id: 9, title: "Ok" }] }, "stripe")
    expect(cards).toHaveLength(2)
    expect(cards[1]!.id).toBe("9")
  })

  test("tolerates a missing or non-array jobs field", () => {
    expect(parseJobs(null, "b")).toEqual([])
    expect(parseJobs({}, "b")).toEqual([])
  })
})

describe("matchesQuery", () => {
  const c = normalizeJob(FIXTURE, "stripe")!

  test("matches title terms case-insensitively, requiring all (AND)", () => {
    expect(matchesQuery(c, "engineer")).toBe(true)
    expect(matchesQuery(c, "SOFTWARE engineer")).toBe(true)
    expect(matchesQuery(c, "engineer plumbing")).toBe(false)
  })

  test("does NOT match on company — every job on a board shares it", () => {
    expect(matchesQuery(c, "stripe")).toBe(false)
  })
})

describe("matchesLocation", () => {
  const mk = (loc: string) => normalizeJob({ id: 1, title: "T", location: { name: loc } }, "b")!

  test("'Remote' catches the common Greenhouse remote spellings", () => {
    for (const l of ["US - Remote", "US Remote", "Remote", "Anywhere", "Distributed - US"]) {
      expect(matchesLocation(mk(l), "Remote")).toBe(true)
    }
    expect(matchesLocation(mk("South San Francisco, CA"), "Remote")).toBe(false)
  })

  test("a named place matches as a substring", () => {
    expect(matchesLocation(mk("South San Francisco, CA"), "san francisco")).toBe(true)
    expect(matchesLocation(mk("New York"), "Austin")).toBe(false)
  })

  test("a job with no location is excluded when filtering, included otherwise", () => {
    const noLoc = normalizeJob({ id: 1, title: "T" }, "b")!
    expect(matchesLocation(noLoc, "Remote")).toBe(false)
    expect(matchesLocation(noLoc, undefined)).toBe(true)
  })
})

describe("withinJobAge", () => {
  const now = Date.parse("2026-08-10T00:00:00Z")
  const c = normalizeJob(FIXTURE, "stripe")! // first_published 2026-08-01

  test("keeps postings inside the window and drops older ones", () => {
    expect(withinJobAge(c, 30, now)).toBe(true)
    expect(withinJobAge(c, 3, now)).toBe(false)
  })

  test("a sentinel age disables the filter", () => {
    expect(withinJobAge(c, 9999, now)).toBe(true)
  })
})

describe("parseBoards", () => {
  test("splits, trims and drops empties", () => {
    expect(parseBoards("stripe, databricks ,,figma")).toEqual(["stripe", "databricks", "figma"])
    expect(parseBoards("   ")).toEqual([])
  })
})

describe("html handling", () => {
  test("decodes Greenhouse's double-escaped content into readable text", () => {
    const text = htmlToText(FIXTURE.content!)
    expect(text).toContain("About & more")
    expect(text).toContain("- Ship code")
    expect(text).not.toContain("<p>")
    expect(text).not.toContain("&lt;")
  })

  test("decodes named, decimal and hex entities", () => {
    expect(decodeHtmlEntities("R&amp;D caf&#233; caf&#xE9;")).toBe("R&D café café")
  })
})

describe("detail ref parsing", () => {
  test("resolves a board + id from a greenhouse job URL alone", () => {
    expect(parseRef("https://boards.greenhouse.io/stripe/jobs/8023928", undefined)).toEqual({
      board: "stripe",
      id: "8023928",
    })
  })

  test("resolves a bare id when --company supplies the board", () => {
    expect(parseRef("8023928", "stripe")).toEqual({ board: "stripe", id: "8023928" })
  })

  test("resolves a company careers URL carrying gh_jid", () => {
    expect(parseRef("https://stripe.com/jobs/search?gh_jid=8023928", "stripe")).toEqual({
      board: "stripe",
      id: "8023928",
    })
  })

  test("a bare id without a board is unresolvable — ids are board-scoped", () => {
    expect(parseRef("8023928", undefined)).toBeNull()
    expect(parseRef("nonsense", "stripe")).toBeNull()
  })

  test("buildDetail carries description, departments and offices", () => {
    const d = buildDetail(FIXTURE, "stripe")!
    expect(d.description).toContain("Ship code")
    expect(d.departments).toBe("Security Analytics")
    expect(d.offices).toBe("US")
    expect(d.applyUrl).toBe(d.url)
  })
})
