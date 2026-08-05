// Offline tests over pure functions — no network. CI runs these; live portal
// testing stays a local, on-demand step (see .github/workflows/ci.yml).
import { describe, expect, test } from "bun:test"
import {
  normalizeJob,
  parseJobs,
  matchesQuery,
  withinJobAge,
  normalizeLocation,
  htmlToText,
  decodeHtmlEntities,
  type RawMuseJob,
} from "../src/helpers.js"
import { extractId, buildDetail } from "../src/commands/detail.js"

const FIXTURE: RawMuseJob = {
  id: 20693577,
  name: " Senior Technical Product Manager - AvaCloud",
  contents: "<p><strong>About</strong></p><ul><li>Build things</li></ul>",
  publication_date: "2026-08-01T12:00:00Z",
  short_name: "senior-technical-product-manager-avacloud",
  company: { id: 15000201, short_name: "avalabs", name: "Ava Labs" },
  locations: [{ name: "Flexible / Remote" }, { name: "New York, NY" }],
  levels: [{ name: "Senior Level", short_name: "senior" }],
  categories: [{ name: "Product Management" }],
  refs: { landing_page: "https://www.themuse.com/jobs/avalabs/x" },
}

describe("normalizeJob", () => {
  test("maps the documented field paths onto the contract shape", () => {
    const card = normalizeJob(FIXTURE)!
    expect(card.id).toBe("20693577")
    expect(card.title).toBe("Senior Technical Product Manager - AvaCloud")
    expect(card.company).toBe("Ava Labs")
    expect(card.location).toBe("Flexible / Remote; New York, NY")
    expect(card.date).toBe("2026-08-01T12:00:00Z")
    expect(card.url).toBe("https://www.themuse.com/jobs/avalabs/x")
    expect(card.levels).toBe("Senior Level")
  })

  test("contract fields are null, never omitted, when the API omits them", () => {
    const card = normalizeJob({ id: 1, name: "Bare" })!
    expect(card.company).toBeNull()
    expect(card.location).toBeNull()
    expect(card.date).toBeNull()
    expect(card.levels).toBeNull()
    expect(card.categories).toBeNull()
    expect(card.url).toContain("themuse.com")
  })

  test("rejects records with no usable id or title", () => {
    expect(normalizeJob({ name: "no id" })).toBeNull()
    expect(normalizeJob({ id: 5 })).toBeNull()
    expect(normalizeJob(null as unknown as RawMuseJob)).toBeNull()
  })

  test("falls back to a constructed URL when refs.landing_page is absent", () => {
    const card = normalizeJob({ ...FIXTURE, refs: null })!
    expect(card.url).toBe(
      "https://www.themuse.com/jobs/avalabs/senior-technical-product-manager-avacloud",
    )
  })
})

describe("parseJobs", () => {
  test("one malformed record cannot break the rest of the page", () => {
    const cards = parseJobs({ results: [FIXTURE, { name: "broken" }, { id: 9, name: "Ok" }] })
    expect(cards).toHaveLength(2)
    expect(cards[1]!.id).toBe("9")
  })

  test("tolerates a missing or non-array results field", () => {
    expect(parseJobs(null)).toEqual([])
    expect(parseJobs({})).toEqual([])
    expect(parseJobs({ results: undefined })).toEqual([])
  })
})

describe("matchesQuery", () => {
  const card = normalizeJob(FIXTURE)!

  test("matches on title and company, case-insensitively", () => {
    expect(matchesQuery(card, "product")).toBe(true)
    expect(matchesQuery(card, "AVA LABS")).toBe(true)
  })

  test("requires every term to match (AND)", () => {
    expect(matchesQuery(card, "senior product")).toBe(true)
    expect(matchesQuery(card, "senior plumbing")).toBe(false)
  })

  test("does NOT match on category — the bug that made -q a no-op", () => {
    // Every result under --category "Software Engineering" contains "engineer"
    // in its category, so matching there passed everything through.
    const eng = normalizeJob({
      id: 2,
      name: "Director, HRBP",
      categories: [{ name: "Software Engineering" }],
      company: { name: "Equinix, Inc" },
    })!
    expect(matchesQuery(eng, "engineer")).toBe(false)
  })

  test("an empty query is a pass-through", () => {
    expect(matchesQuery(card, undefined)).toBe(true)
    expect(matchesQuery(card, "")).toBe(true)
  })
})

describe("withinJobAge", () => {
  const now = Date.parse("2026-08-10T00:00:00Z")
  const card = normalizeJob(FIXTURE)! // published 2026-08-01

  test("keeps postings inside the window and drops older ones", () => {
    expect(withinJobAge(card, 30, now)).toBe(true)
    expect(withinJobAge(card, 3, now)).toBe(false)
  })

  test("a sentinel or absent age disables the filter", () => {
    expect(withinJobAge(card, 9999, now)).toBe(true)
    expect(withinJobAge(card, 0, now)).toBe(true)
  })

  test("an undated or unparseable posting is excluded when filtering", () => {
    const undated = normalizeJob({ id: 3, name: "No date" })!
    expect(withinJobAge(undated, 30, now)).toBe(false)
  })
})

describe("normalizeLocation", () => {
  test("maps remote synonyms onto The Muse's own bucket name", () => {
    for (const v of ["Remote", "remote", "Anywhere", "Flexible"]) {
      expect(normalizeLocation(v)).toBe("Flexible / Remote")
    }
  })

  test("passes a real place through untouched", () => {
    expect(normalizeLocation("Austin, TX")).toBe("Austin, TX")
  })
})

describe("html handling", () => {
  test("decodes named, decimal and hex entities", () => {
    expect(decodeHtmlEntities("R&amp;D caf&#233; caf&#xE9;")).toBe("R&D café café")
  })

  test("strips tags while keeping list and paragraph structure", () => {
    const text = htmlToText(FIXTURE.contents!)
    expect(text).toContain("About")
    expect(text).toContain("- Build things")
    expect(text).not.toContain("<")
  })
})

describe("detail helpers", () => {
  test("extracts an id from a bare number or a job URL", () => {
    expect(extractId("20693577")).toBe("20693577")
    expect(extractId("https://www.themuse.com/jobs/avalabs/some-role-20693577")).toBe("20693577")
    expect(extractId("not-an-id")).toBeNull()
  })

  test("buildDetail carries a readable description and an apply URL", () => {
    const d = buildDetail(FIXTURE)!
    expect(d.description).toContain("Build things")
    expect(d.applyUrl).toBe(d.url)
  })
})
