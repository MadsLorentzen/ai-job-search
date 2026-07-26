import { describe, expect, test } from "bun:test"
import {
  buildLocationKey,
  slugifyLocation,
  htmlToText,
  decodeHtmlEntities,
  normalizeCard,
  publicUrl,
  withinJobAge,
  type RawPosting,
  type JobCard,
} from "../src/helpers.js"
import { slugFromInput } from "../src/commands/detail.js"

describe("slugifyLocation", () => {
  test("strips French diacritics", () => {
    expect(slugifyLocation("Île-de-France")).toBe("ile-de-france")
    expect(slugifyLocation("Provence-Alpes-Côte d'Azur")).toBe("provence-alpes-cote-d-azur")
  })
  test("collapses whitespace and punctuation", () => {
    expect(slugifyLocation("  Auvergne Rhône-Alpes  ")).toBe("auvergne-rhone-alpes")
  })
})

describe("buildLocationKey", () => {
  test("wraps a friendly name into a region-level key", () => {
    expect(buildLocationKey("Ile-de-France")).toBe("fr~ile-de-france~~")
    expect(buildLocationKey("Île-de-France")).toBe("fr~ile-de-france~~")
  })
  test("passes an exact key through untouched", () => {
    const key = "fr~auvergne-rhone-alpes~haute-savoie~annecy"
    expect(buildLocationKey(key)).toBe(key)
  })
})

describe("decodeHtmlEntities", () => {
  test("decodes named, decimal and hex references", () => {
    expect(decodeHtmlEntities("10&#43; years")).toBe("10+ years")
    expect(decodeHtmlEntities("s&#039;adjoindre")).toBe("s'adjoindre")
    expect(decodeHtmlEntities("caf&#xE9;")).toBe("café")
  })
  test("decodes &amp; last so double-encoded entities survive", () => {
    // "&amp;#43;" must become the literal text "&#43;", not "+".
    expect(decodeHtmlEntities("R&amp;D &amp;#43;")).toBe("R&D &#43;")
  })
})

describe("htmlToText", () => {
  test("returns null for empty input", () => {
    expect(htmlToText(null)).toBeNull()
    expect(htmlToText("")).toBeNull()
  })
  test("renders list items as dashes and collapses <br> padding", () => {
    const html = "<p>Missions:</p><br /><ul><br /> <li>Coder</li><br /> <li>Tester</li><br /></ul>"
    const text = htmlToText(html)
    expect(text).toContain("- Coder")
    expect(text).toContain("- Tester")
    expect(text).not.toContain("<")
    expect(text).not.toMatch(/\n{3,}/)
  })
  test("normalizes non-breaking spaces", () => {
    expect(htmlToText("<p>freelance also</p>")).toBe("freelance also")
  })
})

const BASE: RawPosting = {
  id: 656630,
  title: "Développeur Back-End",
  slug: "developpeur-back-end",
  job: { slug: "developpeur-back-end-nodejs", name: "Développeur Back-End" },
  company: { name: "Acme" },
  location: { label: "Paris, Île-de-France", shortLabel: "Paris" },
  publishedAt: "2026-07-20T10:00:00+02:00",
  contracts: ["contractor"],
}

describe("publicUrl", () => {
  test("builds the /job-mission/<category>/<slug> path", () => {
    expect(publicUrl(BASE)).toBe(
      "https://www.free-work.com/fr/tech-it/job-mission/developpeur-back-end-nodejs/developpeur-back-end",
    )
  })
  test("degrades to a site search when the category slug is missing", () => {
    const url = publicUrl({ ...BASE, job: null })
    expect(url).toContain("/fr/tech-it/jobs?query=")
    expect(url).not.toContain("job-mission")
  })
})

describe("normalizeCard", () => {
  test("maps the contract fields", () => {
    const c = normalizeCard(BASE)
    expect(c.id).toBe("656630")
    expect(c.slug).toBe("developpeur-back-end")
    expect(c.title).toBe("Développeur Back-End")
    expect(c.company).toBe("Acme")
    expect(c.location).toBe("Paris, Île-de-France")
    expect(c.date).toBe("2026-07-20T10:00:00+02:00")
  })
  test("emits nulls rather than omitting missing values", () => {
    const c = normalizeCard({ id: 1, slug: "x", job: { slug: "y" } })
    expect(c.company).toBeNull()
    expect(c.location).toBeNull()
    expect(c.dailyRate).toBeNull()
    expect(c.duration).toBeNull()
    expect(c.renewable).toBeNull()
    expect(c.contracts).toEqual([])
  })
  test("formats a daily rate range and a single value", () => {
    expect(
      normalizeCard({ ...BASE, minDailySalary: 400, maxDailySalary: 580, currency: "EUR" }).dailyRate,
    ).toBe("400-580 EUR/day")
    expect(
      normalizeCard({ ...BASE, minDailySalary: 600, maxDailySalary: 600, currency: "EUR" }).dailyRate,
    ).toBe("600 EUR/day")
    expect(normalizeCard({ ...BASE, maxDailySalary: 700 }).dailyRate).toBe("700 EUR/day")
  })
  test("formats duration with pluralization", () => {
    expect(normalizeCard({ ...BASE, durationValue: 6, durationPeriod: "month" }).duration).toBe("6 months")
    expect(normalizeCard({ ...BASE, durationValue: 1, durationPeriod: "year" }).duration).toBe("1 year")
  })
})

describe("withinJobAge", () => {
  const mk = (date: string | null): JobCard => ({ ...normalizeCard(BASE), date })

  test("keeps everything when the age is unset", () => {
    expect(withinJobAge([mk("2000-01-01T00:00:00Z")], 9999)).toHaveLength(1)
  })
  test("drops postings older than the cutoff", () => {
    const old = new Date(Date.now() - 40 * 86400_000).toISOString()
    const fresh = new Date(Date.now() - 2 * 86400_000).toISOString()
    const kept = withinJobAge([mk(old), mk(fresh)], 14)
    expect(kept).toHaveLength(1)
    expect(kept[0].date).toBe(fresh)
  })
  test("keeps postings with an unknown or unparseable date", () => {
    expect(withinJobAge([mk(null), mk("not-a-date")], 7)).toHaveLength(2)
  })
})

describe("slugFromInput", () => {
  test("accepts a bare slug", () => {
    expect(slugFromInput("developpeur-back-end")).toBe("developpeur-back-end")
  })
  test("extracts the slug from a full posting URL", () => {
    expect(
      slugFromInput(
        "https://www.free-work.com/fr/tech-it/job-mission/developpeur-back-end-nodejs/developpeur-back-end",
      ),
    ).toBe("developpeur-back-end")
  })
  test("tolerates a trailing slash", () => {
    expect(slugFromInput("https://www.free-work.com/fr/tech-it/job-mission/a/b/")).toBe("b")
  })
  test("rejects a bare numeric id, which the API cannot resolve", () => {
    expect(slugFromInput("656630")).toBeNull()
  })
  test("rejects empty input", () => {
    expect(slugFromInput("   ")).toBeNull()
  })
})
