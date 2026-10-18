import { describe, expect, test } from "bun:test"
import {
  MAX_PAGE,
  buildSearchUrl,
  extractJsonAfter,
  jobageToFromage,
  parseSearchPage,
} from "../src/helpers"

const MARKER = 'window.mosaic.providerData["mosaic-provider-jobcards"]='

/** Build a results page shaped like the live one: JSON assigned inline, then more script. */
function page(results: unknown[], extra = ""): string {
  const data = { metaData: { mosaicProviderJobCardsModel: { results } } }
  return `<html><script>${MARKER}${JSON.stringify(data)};window.mosaic.x=1;</script>${extra}</html>`
}

const CARD = {
  jobkey: "eb247b2ca3c566bf",
  displayTitle: "Ingeniero/a de Calidad de Proveedores",
  title: "Ingeniero/a de Calidad de Proveedores",
  company: "Zennio Avance y Tecnología",
  formattedLocation: "45007 Toledo, Toledo provincia",
  pubDate: "1786597200000",
  salarySnippet: { currency: "EUR", text: "30.000 € - 36.000 € al año" },
  snippet: '<ul style="list-style-type:circle"><li>Grado en Ingenier&iacute;a</li><li>Ingl&eacute;s &amp; Excel</li></ul>',
  sponsored: false,
  remoteLocation: false,
}

describe("extractJsonAfter", () => {
  test("stops at the matching brace, not at the first '};' inside a string", () => {
    const html = `${MARKER}{"a":"x};y","b":{"c":[1,2,{"d":"}"}]}};tail{"z":1}`
    expect(extractJsonAfter(html, MARKER)).toEqual({ a: "x};y", b: { c: [1, 2, { d: "}" }] } })
  })

  test("handles escaped quotes inside strings", () => {
    const html = `${MARKER}{"a":"he said \\"}\\" ok"};`
    expect(extractJsonAfter(html, MARKER)).toEqual({ a: 'he said "}" ok' })
  })

  test("returns null when the marker is absent or the JSON is truncated", () => {
    expect(extractJsonAfter("<html></html>", MARKER)).toBeNull()
    expect(extractJsonAfter(`${MARKER}{"a":`, MARKER)).toBeNull()
  })
})

describe("parseSearchPage", () => {
  test("maps every field of a card", () => {
    const { cards } = parseSearchPage(page([CARD]))
    expect(cards).toEqual([
      {
        id: "eb247b2ca3c566bf",
        title: "Ingeniero/a de Calidad de Proveedores",
        company: "Zennio Avance y Tecnología",
        location: "45007 Toledo, Toledo provincia",
        date: "2026-08-13",
        url: "https://es.indeed.com/viewjob?jk=eb247b2ca3c566bf",
        salary: "30.000 € - 36.000 € al año",
        snippet: "Grado en Ingeniería | Inglés & Excel",
        sponsored: false,
        remote: false,
      },
    ])
  })

  test("reads the total from totalJobCount", () => {
    expect(parseSearchPage(page([CARD], '"totalJobCount":11,')).total).toBe(11)
  })

  test("a card missing a key or title is skipped without breaking the rest", () => {
    const { cards } = parseSearchPage(page([{ title: "no key" }, { jobkey: "aaaaaaaaaaaaaaaa" }, CARD, null]))
    expect(cards.map((c) => c.id)).toEqual(["eb247b2ca3c566bf"])
  })

  test("missing optional values become null/false, never omitted", () => {
    const { cards } = parseSearchPage(page([{ jobkey: "aaaaaaaaaaaaaaaa", title: "Operario" }]))
    expect(cards[0]).toMatchObject({
      company: null,
      location: null,
      date: null,
      salary: null,
      snippet: null,
      sponsored: false,
      remote: false,
    })
  })

  test("an explicit no-results page parses to an empty list", () => {
    const html = '<div class="jobsearch-NoResult-messageContainer">La búsqueda no coincide</div>"totalJobCount":0,'
    expect(parseSearchPage(html)).toEqual({ cards: [], total: 0 })
  })

  test("a page with neither cards nor the no-results block is PARSE_FAILED, not 'zero jobs'", () => {
    expect(() => parseSearchPage("<html>Authenticating...</html>")).toThrow(
      expect.objectContaining({ code: "PARSE_FAILED" }),
    )
  })
})

describe("jobageToFromage", () => {
  test.each([
    [1, 1],
    [2, 3],
    [3, 3],
    [5, 7],
    [7, 7],
    [10, 14],
    [14, 14],
    [30, null],
    [9999, null],
  ])("%d days -> %p", (days, expected) => {
    expect(jobageToFromage(days)).toBe(expected as number | null)
  })
})

describe("buildSearchUrl", () => {
  const base = { jobage: 9999, page: 1 }

  test("encodes the query, sorts by date, and omits start on page 1", () => {
    const url = buildSearchUrl({ ...base, query: "jefe de producción", location: "Toledo" })
    expect(url).toBe("https://es.indeed.com/jobs?q=jefe%20de%20producci%C3%B3n&l=Toledo&sort=date")
  })

  test("adds fromage for a freshness window", () => {
    expect(buildSearchUrl({ ...base, query: "x", jobage: 14 })).toContain("&fromage=14")
  })

  test("start is always followed by another parameter, as robots.txt requires", () => {
    for (let page = 2; page <= MAX_PAGE; page++) {
      const url = buildSearchUrl({ ...base, query: "x", page })
      expect(url).toContain(`&start=${(page - 1) * 10}&`)
      expect(url.endsWith(`start=${(page - 1) * 10}`)).toBe(false)
    }
  })

  test("never emits radius, which robots.txt disallows", () => {
    expect(buildSearchUrl({ ...base, query: "x", location: "Toledo", jobage: 7, page: 3 })).not.toContain("radius")
  })
})
