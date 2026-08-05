// Offline tests over pure functions — no network.
import { describe, expect, test } from "bun:test"
import {
  normalizeJob,
  parseJobs,
  matchesQuery,
  matchesLocation,
  matchesWorkplace,
  withinJobAge,
  parseSites,
  toIsoDate,
  htmlToText,
  type RawLeverPosting,
} from "../src/helpers.js"
import { parseRef, buildDetail, buildDescription } from "../src/commands/detail.js"

const UUID = "ac978161-6f46-4f6b-ad9e-a258e642751c"

const FIXTURE: RawLeverPosting = {
  id: UUID,
  text: "Administrative Business Partner",
  createdAt: 1711403416463, // epoch ms
  hostedUrl: `https://jobs.lever.co/palantir/${UUID}`,
  applyUrl: `https://jobs.lever.co/palantir/${UUID}/apply`,
  country: "GB",
  workplaceType: "hybrid",
  descriptionPlain: "A World-Changing Company",
  additionalPlain: "We are an equal opportunity employer.",
  categories: {
    commitment: "Full-time",
    location: "London, United Kingdom",
    team: "Administrative",
    allLocations: ["London, United Kingdom", "New York, NY"],
  },
  lists: [{ text: "Core Responsibilities", content: "<li>Provide support.</li><li>Book travel.</li>" }],
}

describe("toIsoDate", () => {
  test("converts Lever's epoch-milliseconds createdAt to ISO", () => {
    expect(toIsoDate(1711403416463)).toBe("2024-03-25T21:50:16.463Z")
  })

  test("rejects absent or nonsensical values rather than emitting an epoch date", () => {
    expect(toIsoDate(undefined)).toBeNull()
    expect(toIsoDate(0)).toBeNull()
    expect(toIsoDate(NaN)).toBeNull()
  })
})

describe("normalizeJob", () => {
  test("maps the documented field paths onto the contract shape", () => {
    const c = normalizeJob(FIXTURE, "palantir")!
    expect(c.id).toBe(UUID)
    expect(c.title).toBe("Administrative Business Partner")
    expect(c.date).toBe("2024-03-25T21:50:16.463Z")
    expect(c.url).toBe(`https://jobs.lever.co/palantir/${UUID}`)
    expect(c.team).toBe("Administrative")
    expect(c.commitment).toBe("Full-time")
    expect(c.workplaceType).toBe("hybrid")
    expect(c.country).toBe("GB")
  })

  test("prefers allLocations over the single location field", () => {
    expect(normalizeJob(FIXTURE, "palantir")!.location).toBe(
      "London, United Kingdom; New York, NY",
    )
  })

  test("falls back to categories.location when allLocations is absent", () => {
    const c = normalizeJob(
      { ...FIXTURE, categories: { location: "Only, Place" } },
      "palantir",
    )!
    expect(c.location).toBe("Only, Place")
  })

  test("company reflects the site slug — Lever returns no display name", () => {
    expect(normalizeJob(FIXTURE, "palantir")!.company).toBe("palantir")
  })

  test("contract fields are null, never omitted", () => {
    const c = normalizeJob({ id: UUID, text: "Bare" }, "acme")!
    expect(c.location).toBeNull()
    expect(c.date).toBeNull()
    expect(c.team).toBeNull()
    expect(c.commitment).toBeNull()
    expect(c.workplaceType).toBeNull()
    expect(c.country).toBeNull()
    expect(c.url).toBe(`https://jobs.lever.co/acme/${UUID}`)
  })

  test("rejects records with no usable id or title", () => {
    expect(normalizeJob({ text: "no id" }, "s")).toBeNull()
    expect(normalizeJob({ id: UUID }, "s")).toBeNull()
    expect(normalizeJob(null as unknown as RawLeverPosting, "s")).toBeNull()
  })
})

describe("parseJobs", () => {
  test("one malformed record cannot break the rest", () => {
    const cards = parseJobs([FIXTURE, { text: "broken" }, { id: "x", text: "Ok" }], "palantir")
    expect(cards).toHaveLength(2)
    expect(cards[1]!.id).toBe("x")
  })

  test("tolerates a non-array response", () => {
    expect(parseJobs(null, "s")).toEqual([])
    expect(parseJobs({} as unknown as RawLeverPosting[], "s")).toEqual([])
  })
})

describe("matchesQuery", () => {
  const c = normalizeJob(FIXTURE, "palantir")!

  test("matches title terms case-insensitively, requiring all (AND)", () => {
    expect(matchesQuery(c, "administrative")).toBe(true)
    expect(matchesQuery(c, "BUSINESS partner")).toBe(true)
    expect(matchesQuery(c, "business plumbing")).toBe(false)
  })

  test("does NOT match on company — every posting on a site shares it", () => {
    expect(matchesQuery(c, "palantir")).toBe(false)
  })
})

describe("matchesLocation / matchesWorkplace", () => {
  const mk = (loc: string, wt?: string) =>
    normalizeJob(
      { id: UUID, text: "T", categories: { location: loc }, workplaceType: wt },
      "s",
    )!

  test("'Remote' matches via workplaceType even when the location is a city", () => {
    expect(matchesLocation(mk("New York, NY", "remote"), "Remote")).toBe(true)
  })

  test("'Remote' also matches remote-ish location strings", () => {
    expect(matchesLocation(mk("Remote - US"), "Remote")).toBe(true)
    expect(matchesLocation(mk("Anywhere"), "Remote")).toBe(true)
    expect(matchesLocation(mk("Palo Alto, CA"), "Remote")).toBe(false)
  })

  test("a named place matches as a substring", () => {
    expect(matchesLocation(mk("London, United Kingdom"), "london")).toBe(true)
    expect(matchesLocation(mk("London, United Kingdom"), "Austin")).toBe(false)
  })

  test("workplaceType filter is exact and normalizes on-site", () => {
    expect(matchesWorkplace(mk("X", "remote"), "remote")).toBe(true)
    expect(matchesWorkplace(mk("X", "hybrid"), "remote")).toBe(false)
    expect(matchesWorkplace(mk("X", "onsite"), "on-site")).toBe(true)
    expect(matchesWorkplace(mk("X", "remote"), undefined)).toBe(true)
  })
})

describe("withinJobAge", () => {
  const now = Date.parse("2024-04-01T00:00:00Z")
  const c = normalizeJob(FIXTURE, "palantir")! // created 2024-03-25

  test("keeps postings inside the window and drops older ones", () => {
    expect(withinJobAge(c, 30, now)).toBe(true)
    expect(withinJobAge(c, 3, now)).toBe(false)
  })

  test("a sentinel age disables the filter", () => {
    expect(withinJobAge(c, 9999, now)).toBe(true)
  })
})

describe("parseSites", () => {
  test("splits, trims and drops empties", () => {
    expect(parseSites("palantir, plaid ,,figma")).toEqual(["palantir", "plaid", "figma"])
    expect(parseSites("  ")).toEqual([])
  })
})

describe("buildDescription", () => {
  test("concatenates descriptionPlain + lists + additionalPlain", () => {
    const d = buildDescription(FIXTURE)!
    expect(d).toContain("A World-Changing Company")
    expect(d).toContain("Core Responsibilities")
    expect(d).toContain("- Provide support.")
    expect(d).toContain("equal opportunity")
  })

  test("a posting with only lists still produces a description", () => {
    const d = buildDescription({ lists: [{ text: "Reqs", content: "<li>One</li>" }] })!
    expect(d).toContain("Reqs")
    expect(d).toContain("- One")
  })

  test("returns null when there is genuinely nothing to show", () => {
    expect(buildDescription({})).toBeNull()
  })
})

describe("htmlToText", () => {
  test("converts list items to dashes and strips tags", () => {
    expect(htmlToText("<li>One</li><li>Two</li>")).toBe("- One\n- Two")
  })
})

describe("detail ref parsing", () => {
  test("resolves a site + id from a lever job URL alone", () => {
    expect(parseRef(`https://jobs.lever.co/palantir/${UUID}`, undefined)).toEqual({
      site: "palantir",
      id: UUID,
    })
  })

  test("resolves a bare UUID when --company supplies the site", () => {
    expect(parseRef(UUID, "palantir")).toEqual({ site: "palantir", id: UUID })
  })

  test("a bare UUID without a site is unresolvable — ids are site-scoped", () => {
    expect(parseRef(UUID, undefined)).toBeNull()
  })

  test("rejects a non-UUID id (Lever ids are always UUIDs)", () => {
    expect(parseRef("12345", "palantir")).toBeNull()
    expect(parseRef("nonsense", "palantir")).toBeNull()
  })

  test("buildDetail prefers the API's applyUrl", () => {
    const d = buildDetail(FIXTURE, "palantir")!
    expect(d.applyUrl).toBe(`https://jobs.lever.co/palantir/${UUID}/apply`)
    expect(d.description).toContain("Core Responsibilities")
  })
})
