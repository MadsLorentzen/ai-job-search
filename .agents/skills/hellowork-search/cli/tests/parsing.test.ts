import { describe, expect, test } from "bun:test"
import {
  parseRelativeDate,
  parseJobCards,
  extractJobPostingLd,
  extractContract,
  htmlToText,
  decodeHtmlEntities,
  normalizeContracts,
  jobageToParam,
} from "../src/helpers.js"

// Fixed reference date so relative-date assertions are deterministic.
const NOW = new Date("2026-07-27T12:00:00Z")

describe("parseRelativeDate", () => {
  test("hours resolve to today", () => {
    expect(parseRelativeDate("il y a 18 heures", NOW)).toEqual({
      date: "2026-07-27",
      ageDays: 0,
    })
  })

  test("days subtract calendar days", () => {
    expect(parseRelativeDate("il y a 5 jours", NOW)).toEqual({
      date: "2026-07-22",
      ageDays: 5,
    })
  })

  test("weeks and months scale", () => {
    expect(parseRelativeDate("il y a 2 semaines", NOW).ageDays).toBe(14)
    expect(parseRelativeDate("il y a 1 mois", NOW).ageDays).toBe(30)
  })

  test("hier resolves to yesterday", () => {
    expect(parseRelativeDate("hier", NOW)).toEqual({ date: "2026-07-26", ageDays: 1 })
  })

  // The freshest listings drop the "il y a" prefix entirely.
  test("prefixless 'moins d'une heure' resolves to today", () => {
    expect(parseRelativeDate("moins d'une heure", NOW)).toEqual({
      date: "2026-07-27",
      ageDays: 0,
    })
  })

  test("'plus d'un mois' resolves to the 30-day ceiling", () => {
    expect(parseRelativeDate("plus d'un mois", NOW).ageDays).toBe(30)
  })

  test("unrecognised labels yield nulls rather than a guess", () => {
    expect(parseRelativeDate("bientôt", NOW)).toEqual({ date: null, ageDays: null })
    expect(parseRelativeDate(null, NOW)).toEqual({ date: null, ageDays: null })
  })
})

describe("decodeHtmlEntities", () => {
  test("decodes the hex refs HelloWork uses for accents", () => {
    expect(decodeHtmlEntities("D&#xE9;veloppeur")).toBe("Développeur")
  })

  test("does not double-decode an escaped entity", () => {
    expect(decodeHtmlEntities("R&amp;D &amp;#xE9;")).toBe("R&D &#xE9;")
  })
})

describe("htmlToText", () => {
  test("strips tags, decodes entities, and keeps paragraph breaks", () => {
    const html = "<h2>Missions</h2><p>Back&#xE9;nd<br />Rust</p><ul><li>API</li><li>SQL</li></ul>"
    const text = htmlToText(html)
    expect(text).toContain("Backénd")
    expect(text).toContain("- API")
    expect(text).not.toContain("<")
    expect(text).not.toMatch(/\n{3,}/)
  })
})

describe("normalizeContracts", () => {
  test("maps English aliases onto HelloWork values", () => {
    expect(normalizeContracts("freelance,permanent").values).toEqual(["Freelance", "CDI"])
  })

  test("accepts exact values case-insensitively", () => {
    expect(normalizeContracts("FREELANCE").values).toEqual(["Freelance"])
  })

  test("reports unknown values instead of dropping them silently", () => {
    const { values, unknown } = normalizeContracts("Freelance,Portage")
    expect(values).toEqual(["Freelance"])
    expect(unknown).toEqual(["Portage"])
  })
})

describe("jobageToParam", () => {
  test("picks the tightest bucket that still contains the requested age", () => {
    expect(jobageToParam(1)).toBe("h")
    expect(jobageToParam(3)).toBe("d")
    expect(jobageToParam(5)).toBe("w")
    expect(jobageToParam(30)).toBe("m")
    expect(jobageToParam(90)).toBeNull()
    expect(jobageToParam(9999)).toBeNull()
  })
})

// A trimmed card matching HelloWork's live markup shape.
const CARD_HTML = `
<li data-id-storage-item-id="81760816" data-hide-offer-item-id-value="81760816">
  <a href="/fr-fr/emplois/81760816.html" data-cy="offerTitle">
    <h3 class="inline"><p class="typo-l">D&#xE9;veloppeur Back-End</p><p class="typo-s inline">Celad</p></h3>
  </a>
  <div data-cy="contractCard">Freelance</div>
  <div class="typo-s text-grey-500 pl-1 pt-1">moins d&#x27;une heure</div>
</li>
<li data-id-storage-item-id="81577686" data-hide-offer-item-id-value="81577686">
  <a data-turbo="false" href="/fr-fr/emplois/81577686.html"
     title="D&#xE9;veloppeur Mulesoft - Salesforce H/F - Celad" data-cy="offerTitle">
    <h3 class="inline">
      <p class="typo-l sm:typo-xl">D&#xE9;veloppeur Mulesoft - Salesforce H/F</p>
      <p class="typo-s inline">Celad</p>
    </h3>
  </a>
  <div class="readonly tag-secondary-s w-fit border-0" data-cy="localisationCard">Paris - 75</div>
  <div class="readonly tag-secondary-s w-fit border-0" data-cy="contractCard">Freelance</div>
  <div class="readonly tag-secondary-s typo-s-bold w-fit border-0">500 - 550 &#x20AC; / jour</div>
  <div class="typo-s text-grey-500 pl-1 pt-1">il y a 5 jours</div>
</li>
<li data-id-storage-item-id="81748461" data-hide-offer-item-id-value="81748461">
  <a href="/fr-fr/emplois/81748461.html" data-cy="offerTitle" title="Ing&#xE9;nieur Backend - ACME">
    <h3 class="inline"><p class="typo-l">Ing&#xE9;nieur Backend</p><p class="typo-s inline">ACME</p></h3>
  </a>
  <div data-cy="localisationCard">Lyon - 69</div>
  <div data-cy="contractCard">CDI</div>
  <div class="typo-s text-grey-500">il y a 18 heures</div>
</li>
`

describe("parseJobCards", () => {
  const cards = parseJobCards(CARD_HTML, NOW)
  const byId = (id: string) => cards.find((c) => c.id === id)!

  test("parses one record per card", () => {
    expect(cards.length).toBe(3)
    expect(cards.map((c) => c.id)).toEqual(["81760816", "81577686", "81748461"])
  })

  test("decodes titles and separates the company", () => {
    expect(byId("81577686").title).toBe("Développeur Mulesoft - Salesforce H/F")
    expect(byId("81577686").company).toBe("Celad")
    expect(byId("81748461").title).toBe("Ingénieur Backend")
    expect(byId("81748461").company).toBe("ACME")
  })

  test("captures location, contract, and TJM", () => {
    expect(byId("81577686").location).toBe("Paris - 75")
    expect(byId("81577686").contract).toBe("Freelance")
    expect(byId("81577686").salary).toBe("500 - 550 € / jour")
  })

  test("leaves an absent salary null rather than omitting the field", () => {
    expect(byId("81748461").salary).toBeNull()
    expect("salary" in byId("81748461")).toBe(true)
  })

  test("builds absolute URLs and resolves dates", () => {
    expect(byId("81577686").url).toBe("https://www.hellowork.com/fr-fr/emplois/81577686.html")
    expect(byId("81577686").date).toBe("2026-07-22")
    expect(byId("81577686").ageDays).toBe(5)
    expect(byId("81748461").ageDays).toBe(0)
  })

  // Regression: the freshest cards use a prefixless label, which an "il y a"-only
  // gate silently rejected — the card parsed but came back with no date at all.
  test("accepts the prefixless label on brand-new listings", () => {
    expect(byId("81760816").dateRelative).toBe("moins d'une heure")
    expect(byId("81760816").date).toBe("2026-07-27")
    expect(byId("81760816").ageDays).toBe(0)
  })

  test("a malformed card does not break the ones around it", () => {
    const broken = CARD_HTML.replace("<h3 class=\"inline\">\n      <p", "<h3 BROKEN <p")
    const parsed = parseJobCards(broken, NOW)
    // The second card must still parse cleanly.
    expect(parsed.some((c) => c.id === "81748461" && c.title === "Ingénieur Backend")).toBe(true)
  })
})

describe("extractJobPostingLd", () => {
  test("finds the JobPosting block among several JSON-LD scripts", () => {
    const html = `
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Hellowork"}</script>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Dev"}</script>
    `
    expect(extractJobPostingLd(html)?.title).toBe("Dev")
  })

  test("skips a malformed block and keeps scanning", () => {
    const html = `
      <script type="application/ld+json">{"@type":"JobPosting", BROKEN</script>
      <script type="application/ld+json">{"@type":"JobPosting","title":"Dev"}</script>
    `
    expect(extractJobPostingLd(html)?.title).toBe("Dev")
  })

  test("returns null when there is no JobPosting", () => {
    expect(extractJobPostingLd('<script type="application/ld+json">{"@type":"WebSite"}</script>')).toBeNull()
  })
})

describe("extractContract", () => {
  // Regression: a detail page's `data-cy="contractCard"` divs belong to the
  // related-offers sidebar. Reading one yields a *different* job's contract, so
  // the contract must come from the dataLayer blob scoped to this posting's id.
  const DETAIL_HTML = `
    <script>window.dataLayer.push({"idOffre":"81690954","Ville":"paris-75000","contrat":"Freelance","datePublicationOffre":"20260725"});</script>
    <h1><span>Senior Backend Developer</span></h1>
    <ul class="mt-3 inline-flex"><li>Paris - 75</li><li>Freelance</li></ul>
    <aside>
      <div data-cy="localisationCard">Buc - 78</div>
      <div data-cy="contractCard">CDI</div>
      <div data-cy="contractCard">Stage</div>
    </aside>
  `

  test("reads the posting's own contract, not the sidebar's", () => {
    expect(extractContract(DETAIL_HTML, "81690954")).toBe("Freelance")
  })

  test("falls back to the header tag list when the dataLayer blob is absent", () => {
    const noBlob = DETAIL_HTML.replace(/<script>[\s\S]*?<\/script>/, "")
    expect(extractContract(noBlob, "81690954")).toBe("Freelance")
  })

  test("does not borrow a contract from another posting's blob", () => {
    const otherOnly = DETAIL_HTML
      .replace('"idOffre":"81690954"', '"idOffre":"99999999"')
      .replace(/<ul class="mt-3[\s\S]*?<\/ul>/, "")
    expect(extractContract(otherOnly, "81690954")).toBeNull()
  })
})
