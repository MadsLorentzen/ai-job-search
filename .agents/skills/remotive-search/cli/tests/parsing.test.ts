// Offline tests over pure functions — no network.
import { describe, expect, test } from "bun:test"
import {
  normalizeJob,
  parseJobs,
  matchesQuery,
  matchesCategory,
  matchesLocation,
  withinJobAge,
  toIsoDate,
  htmlToText,
  type RawRemotiveJob,
} from "../src/helpers.js"
import { extractId, selectFromFeed } from "../src/commands/detail.js"

const FIXTURE: RawRemotiveJob = {
  id: 1749306,
  title: "Freelance Copywriter",
  company_name: "Coalition Technologies ", // note the trailing space — real feed data
  candidate_required_location: "Worldwide",
  publication_date: "2026-08-02T20:00:46", // no timezone suffix — real feed data
  url: "https://remotive.com/remote-jobs/writing/freelance-copywriter-1749306",
  job_type: "freelance",
  category: "Writing",
  salary: "$20k -$35k",
  tags: ["Copywriting", "SEO"],
  description: "<p>Write &amp; edit copy.</p><ul><li>SEO content</li></ul>",
}

describe("toIsoDate", () => {
  test("treats a timezone-less publication_date as UTC", () => {
    // Without appending Z this parses as local time and shifts by the offset.
    expect(toIsoDate("2026-08-02T20:00:46")).toBe("2026-08-02T20:00:46.000Z")
  })

  test("respects an explicit timezone when one is present", () => {
    expect(toIsoDate("2026-08-02T20:00:46Z")).toBe("2026-08-02T20:00:46.000Z")
  })

  test("rejects absent or unparseable values", () => {
    expect(toIsoDate(undefined)).toBeNull()
    expect(toIsoDate("not-a-date")).toBeNull()
  })
})

describe("normalizeJob", () => {
  test("maps the documented field paths onto the contract shape", () => {
    const c = normalizeJob(FIXTURE)!
    expect(c.id).toBe("1749306")
    expect(c.title).toBe("Freelance Copywriter")
    expect(c.location).toBe("Worldwide")
    expect(c.date).toBe("2026-08-02T20:00:46.000Z")
    expect(c.category).toBe("Writing")
    expect(c.jobType).toBe("freelance")
    expect(c.salary).toBe("$20k -$35k")
    expect(c.tags).toBe("Copywriting, SEO")
    expect(c.source).toBe("Remotive")
  })

  test("trims the trailing space the feed puts on company_name", () => {
    expect(normalizeJob(FIXTURE)!.company).toBe("Coalition Technologies")
  })

  test("contract fields are null, never omitted", () => {
    const c = normalizeJob({ id: 1, title: "Bare" })!
    expect(c.company).toBeNull()
    expect(c.location).toBeNull()
    expect(c.date).toBeNull()
    expect(c.category).toBeNull()
    expect(c.salary).toBeNull()
    expect(c.tags).toBeNull()
  })

  test("rejects records with no usable id or title", () => {
    expect(normalizeJob({ title: "no id" })).toBeNull()
    expect(normalizeJob({ id: 5 })).toBeNull()
    expect(normalizeJob(null as unknown as RawRemotiveJob)).toBeNull()
  })
})

describe("parseJobs", () => {
  test("one malformed record cannot break the rest of the feed", () => {
    const cards = parseJobs({ jobs: [FIXTURE, { title: "broken" }, { id: 9, title: "Ok" }] })
    expect(cards).toHaveLength(2)
    expect(cards[1]!.id).toBe("9")
  })

  test("tolerates a missing jobs array", () => {
    expect(parseJobs(null)).toEqual([])
    expect(parseJobs({})).toEqual([])
  })
})

describe("matchesQuery", () => {
  const c = normalizeJob(FIXTURE)!

  test("matches title, company and tags, requiring all terms", () => {
    expect(matchesQuery(c, "copywriter")).toBe(true)
    expect(matchesQuery(c, "coalition")).toBe(true)
    expect(matchesQuery(c, "seo")).toBe(true) // via tags
    expect(matchesQuery(c, "copywriter plumbing")).toBe(false)
  })
})

describe("matchesCategory", () => {
  const c = normalizeJob({ id: 1, title: "T", category: "Software Development" })!

  test("accepts the human-readable name and the slug form", () => {
    expect(matchesCategory(c, "Software Development")).toBe(true)
    expect(matchesCategory(c, "software-development")).toBe(true)
    expect(matchesCategory(c, "software")).toBe(true)
    expect(matchesCategory(c, "Marketing")).toBe(false)
  })

  test("an uncategorized job is excluded when filtering", () => {
    expect(matchesCategory(normalizeJob({ id: 1, title: "T" })!, "Design")).toBe(false)
  })
})

describe("matchesLocation", () => {
  const mk = (loc: string) => normalizeJob({ id: 1, title: "T", candidate_required_location: loc })!

  test("'USA' also matches the broader eligibility regions that include it", () => {
    for (const l of ["USA", "USA, Canada", "North America", "Worldwide", "Americas"]) {
      expect(matchesLocation(mk(l), "USA")).toBe(true)
    }
  })

  test("'USA' does not match a Europe-only listing", () => {
    expect(matchesLocation(mk("Europe, UK, Germany"), "USA")).toBe(false)
  })

  test("other regions match as a substring", () => {
    expect(matchesLocation(mk("Europe, UK"), "europe")).toBe(true)
  })
})

describe("withinJobAge", () => {
  const now = Date.parse("2026-08-10T00:00:00Z")
  const c = normalizeJob(FIXTURE)! // published 2026-08-02

  test("keeps postings inside the window and drops older ones", () => {
    expect(withinJobAge(c, 30, now)).toBe(true)
    expect(withinJobAge(c, 3, now)).toBe(false)
  })

  test("a sentinel age disables the filter", () => {
    expect(withinJobAge(c, 9999, now)).toBe(true)
  })
})

describe("htmlToText", () => {
  test("decodes entities and converts list items", () => {
    const text = htmlToText(FIXTURE.description!)
    expect(text).toContain("Write & edit copy.")
    expect(text).toContain("- SEO content")
    expect(text).not.toContain("<")
  })
})

describe("detail", () => {
  test("extracts an id from a bare number or a remotive job URL", () => {
    expect(extractId("1749306")).toBe("1749306")
    expect(extractId(FIXTURE.url!)).toBe("1749306")
    expect(extractId("nope")).toBeNull()
  })

  test("selects a job out of the feed — there is no per-job endpoint", () => {
    const d = selectFromFeed({ jobs: [FIXTURE] }, "1749306")!
    expect(d.title).toBe("Freelance Copywriter")
    expect(d.description).toContain("SEO content")
    expect(d.applyUrl).toBe(d.url)
  })

  test("returns null when the id has aged out of the feed", () => {
    expect(selectFromFeed({ jobs: [FIXTURE] }, "999999")).toBeNull()
    expect(selectFromFeed(null, "1749306")).toBeNull()
  })
})
