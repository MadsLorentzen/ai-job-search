import { describe, expect, test } from "bun:test"
import {
  parseJobCards,
  parseJobDetail,
  jobageToTPR,
  workTypeFlag,
} from "../src/helpers.ts"

const SEARCH_HTML = await Bun.file(
  new URL("./__fixtures__/search-list.html", import.meta.url),
).text()
const DETAIL_HTML = await Bun.file(
  new URL("./__fixtures__/detail-orbis.html", import.meta.url),
).text()

describe("parseJobCards", () => {
  const cards = parseJobCards(SEARCH_HTML)

  test("extracts every card in the search list", () => {
    expect(cards).toHaveLength(10)
  })

  test("maps id / title / company / location / date / url for a card", () => {
    // First card in the captured fixture.
    expect(cards[0]).toEqual({
      id: "4425498329",
      title: "Artificial Intelligence Engineer",
      company: "Humans.tech",
      companyUrl: "https://it.linkedin.com/company/wearehumanstech",
      location: "Italy",
      date: "2026-07-10",
      url: "https://it.linkedin.com/jobs/view/artificial-intelligence-engineer-at-humans-tech-4425498329",
    })
  })

  test("every card has a numeric id and a job-view url", () => {
    for (const c of cards) {
      expect(c.id).toMatch(/^\d+$/)
      expect(c.url).toContain("/jobs/view/")
    }
  })

  test("a malformed card does not break the rest", () => {
    // A card whose chunk has no numeric id and no title: it must be skipped
    // (parsing is chunk-independent) without throwing or dropping good cards.
    const broken =
      '<li><div data-entity-urn="urn:li:jobPosting:not-a-number">' +
      '<h3 class="base-search-card__title">ignored</h3></div></li>'
    const withBroken = parseJobCards(SEARCH_HTML + broken)
    expect(withBroken).toHaveLength(10)
    expect(withBroken.map((c) => c.id)).toEqual(cards.map((c) => c.id))
  })

  test("a card missing its title is skipped, later cards still parse", () => {
    // Malformed chunk in the *middle*: valid id, no title -> skipped; the good
    // card that follows must still come through.
    const good = parseJobCards(SEARCH_HTML)[0]
    const titleless = 'data-entity-urn="urn:li:jobPosting:9999999999"><li></li>'
    const spliced = SEARCH_HTML.replace(
      'data-entity-urn="urn:li:jobPosting:',
      titleless + 'data-entity-urn="urn:li:jobPosting:',
    )
    const out = parseJobCards(spliced)
    expect(out).toHaveLength(10)
    expect(out[0]).toEqual(good)
  })

  test("returns an empty array for HTML with no cards", () => {
    expect(parseJobCards("<html><body>nothing here</body></html>")).toEqual([])
  })
})

describe("parseJobDetail", () => {
  const job = parseJobDetail(DETAIL_HTML, "4345841651")

  test("extracts the core fields", () => {
    expect(job.id).toBe("4345841651")
    expect(job.title).toBe("Agentic AI Engineer - Full remote - Europe")
    expect(job.company).toBe("Orbis Group")
    expect(job.companyUrl).toBe("https://uk.linkedin.com/company/weareorbis")
    expect(job.location).toBe("European Union")
    expect(job.url).toBe("https://www.linkedin.com/jobs/view/4345841651")
  })

  test("extracts the job criteria", () => {
    expect(job.seniority).toBe("Mid-Senior level")
    expect(job.employmentType).toBe("Contract")
    expect(job.jobFunction).toBe("Information Technology")
    expect(job.industries).toBe("Technology, Information and Media")
  })

  test("preserves paragraph breaks in the description as newlines", () => {
    expect(job.description).toBeTruthy()
    expect(job.description).toContain("\n")
    // Distinct paragraphs must stay on distinct lines, not collapse into one.
    const lines = job.description!.split("\n").filter((l) => l.trim())
    expect(lines.length).toBeGreaterThan(1)
    // Content from separate paragraphs of the real posting.
    expect(job.description).toContain(
      "Our SaaS client based in The Netherlands",
    )
    expect(job.description).toContain("€375 - 400 a day")
    // No run of tags left behind, no 3+ blank lines.
    expect(job.description).not.toContain("<")
    expect(job.description).not.toMatch(/\n{3,}/)
  })

  test("applyUrl is null when the posting only offers in-platform apply", () => {
    // This Orbis posting renders a login-gated apply button, not an outbound
    // apply link, so there is no URL to surface. See NOTE in the test file.
    expect(job.applyUrl).toBeNull()
  })

  test("degrades gracefully on empty markup", () => {
    const empty = parseJobDetail("", "123456")
    expect(empty.id).toBe("123456")
    expect(empty.title).toBe("(untitled)")
    expect(empty.description).toBeNull()
    expect(empty.seniority).toBeNull()
  })
})

// NOTE on applyUrl: across the 10 real target jobs captured on 2026-07-14, none
// exposed an outbound apply URL — LinkedIn's guest detail pages now render an
// in-platform <button> (apply is behind login), so parseJobDetail's
// `topcard__link[href]` selector matched nothing and applyUrl was null for all
// of them. The tests lock in that real behavior. A fixture that *does* carry an
// outbound apply link (an "offsite apply" posting) should be added if/when one
// is captured, to also cover the non-null extraction path. See AIV-986 report.

describe("jobageToTPR", () => {
  test("maps day windows to f_TPR seconds", () => {
    expect(jobageToTPR(1)).toBe("r86400")
    expect(jobageToTPR(7)).toBe("r604800")
    expect(jobageToTPR(14)).toBe("r1209600")
    expect(jobageToTPR(30)).toBe("r2592000")
  })

  test("returns null for the sentinel / out-of-range values", () => {
    expect(jobageToTPR(0)).toBeNull()
    expect(jobageToTPR(9999)).toBeNull()
    expect(jobageToTPR(-5)).toBeNull()
  })
})

describe("workTypeFlag", () => {
  test("maps workplace modes to f_WT flags", () => {
    expect(workTypeFlag("remote")).toBe("2")
    expect(workTypeFlag("hybrid")).toBe("3")
    expect(workTypeFlag("onsite")).toBe("1")
    expect(workTypeFlag("on-site")).toBe("1")
  })

  test("is case-insensitive", () => {
    expect(workTypeFlag("Remote")).toBe("2")
    expect(workTypeFlag("HYBRID")).toBe("3")
  })

  test("returns null for unknown or missing modes", () => {
    expect(workTypeFlag("anywhere")).toBeNull()
    expect(workTypeFlag("")).toBeNull()
    expect(workTypeFlag(undefined)).toBeNull()
  })
})
