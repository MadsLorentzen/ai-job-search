import { describe, expect, test } from "bun:test"
import {
  matchesLocation,
  parseDmy,
  parseMissionCards,
  parsePublished,
  refFromPath,
  skillMatchesQuery,
  withinJobage,
  type MissionCard,
} from "../src/helpers.js"
import { buildUrl } from "../src/commands/search.js"
import { detailUrl } from "../src/commands/detail.js"

const NOW = new Date("2026-07-29T10:00:00Z")

// Two cards in the portal's two link flavours: a plain href and the base64
// `data-obf` span it randomly swaps in. Both must parse identically.
const HREF_CARD = `
<div class="card job-card-line">
  <div class="row"><div class="col-md-10">
    <h2 class="job-title">
      <a href="/mission-developpeur-java-sur-paris-260728C015" class="stretched-link">Développeur JAVA</a>
    </h2>
    <div class="tags"><span class=" obligatoire" title="Compétence obligatoire">Java</span><span class="">SQL</span></div>
    <p class="line-clamp-2">Nous recherchons un d&eacute;veloppeur JAVA&nbsp pour un client grand compte.</p>
    <ul>
      <li><i class="icon icon-clock"></i> Publiée hier</li>
      <li><i class="icon icon-map"></i> 75 - Paris</li>
      <li><i class="icon icon-calendar"></i> 14/09/2026</li>
      <li><i class="icon icon-time"></i> 3 mois</li>
    </ul>
  </div></div>
</div>`

// base64 of "/mission-consultant-pmo-au-mans-260729G001"
const OBF_CARD = `
<div class="card job-card-line">
  <div class="row"><div class="col-md-10">
    <h2 class="job-title">
      <span data-obf="L21pc3Npb24tY29uc3VsdGFudC1wbW8tYXUtbWFucy0yNjA3MjlHMDAx" class="stretched-link">Consultant PMO</span>
    </h2>
    <p class="line-clamp-2">Mission de pilotage.</p>
    <ul>
      <li><i class="icon icon-clock"></i> Publiée il y a 5 jours</li>
      <li><i class="icon icon-map"></i> Télétravail</li>
      <li><i class="icon icon-calendar"></i> 24/08/2026</li>
      <li><i class="icon icon-time"></i> 3 mois</li>
    </ul>
  </div></div>
</div>`

const BROKEN_CARD = `<div class="card job-card-line"><div class="row">no heading here</div></div>`

describe("parseMissionCards", () => {
  const cards = parseMissionCards(HREF_CARD + OBF_CARD, NOW)

  test("parses both link flavours", () => {
    expect(cards).toHaveLength(2)
    expect(cards[0].id).toBe("260728C015")
    expect(cards[1].id).toBe("260729G001")
    expect(cards[1].url).toBe(
      "https://www.freelance-informatique.fr/mission-consultant-pmo-au-mans-260729G001",
    )
  })

  test("extracts the documented card fields", () => {
    const c = cards[0]
    expect(c.title).toBe("Développeur JAVA")
    expect(c.location).toBe("75 - Paris")
    expect(c.department).toBe("75")
    expect(c.date).toBe("2026-07-28")
    expect(c.startDate).toBe("2026-09-14")
    expect(c.duration).toBe("3 mois")
    expect(c.skills).toEqual(["Java", "SQL"])
    expect(c.excerpt).toContain("développeur JAVA")
  })

  test("company and dailyRate are null — the portal publishes neither", () => {
    expect(cards[0].company).toBeNull()
    expect(cards[0].dailyRate).toBeNull()
  })

  test("a malformed card is skipped without breaking the rest", () => {
    const mixed = parseMissionCards(BROKEN_CARD + HREF_CARD, NOW)
    expect(mixed).toHaveLength(1)
    expect(mixed[0].id).toBe("260728C015")
  })
})

describe("entity decoding", () => {
  // The portal mixes raw UTF-8 with named entities and routinely drops the
  // trailing semicolon on &nbsp / &gt / &amp.
  const card = (body: string) =>
    parseMissionCards(
      `<div class="card job-card-line"><h2 class="job-title">` +
        `<a href="/mission-x-260728C015" class="stretched-link">T</a></h2>` +
        `<p class="line-clamp-2">${body}</p></div>`,
      NOW,
    )[0].excerpt

  test("decodes named entities, including uppercase", () => {
    expect(card("d&eacute;veloppeur &Eacute;quipe")).toBe("développeur Équipe")
  })

  test("decodes semicolon-less forms the portal emits", () => {
    expect(card("Java 8&nbsp&gt Java 21 R&amp;D")).toBe("Java 8 > Java 21 R&D")
  })

  test("leaves unknown entities untouched", () => {
    expect(card("&frobnicate; ok")).toBe("&frobnicate; ok")
  })
})

describe("parsePublished", () => {
  test("handles every wording the portal uses", () => {
    expect(parsePublished("Publiée à l'instant", NOW)).toBe("2026-07-29")
    expect(parsePublished("Publiée aujourd'hui", NOW)).toBe("2026-07-29")
    expect(parsePublished("Publiée hier", NOW)).toBe("2026-07-28")
    expect(parsePublished("Publiée il y a 2 jours", NOW)).toBe("2026-07-27")
    expect(parsePublished("Publiée le 10/07", NOW)).toBe("2026-07-10")
  })

  test("a DD/MM ahead of today belongs to last year", () => {
    expect(parsePublished("Publiée le 15/12", NOW)).toBe("2025-12-15")
  })

  test("returns null on unparseable input", () => {
    expect(parsePublished(null, NOW)).toBeNull()
    expect(parsePublished("Publiée récemment", NOW)).toBeNull()
  })
})

describe("parseDmy / refFromPath", () => {
  test("parses fully-qualified start dates", () => {
    expect(parseDmy("24/08/2026")).toBe("2026-08-24")
    expect(parseDmy("pas une date")).toBeNull()
  })

  test("extracts the mission reference from any path form", () => {
    expect(refFromPath("/mission-developpeur-java-sur-paris-260728C015")).toBe("260728C015")
    expect(refFromPath("260728c015")).toBe("260728C015")
    expect(refFromPath("/offres-freelance")).toBeNull()
  })
})

describe("client-side filters", () => {
  const card = (location: string | null, department: string | null, date: string | null) =>
    ({ location, department, date } as MissionCard)

  test("matches a department number, a city, and the IdF alias", () => {
    expect(matchesLocation(card("75 - Paris", "75", null), "75")).toBe(true)
    expect(matchesLocation(card("75 - PARIS", "75", null), "paris")).toBe(true)
    expect(matchesLocation(card("92 - Courbevoie", "92", null), "idf")).toBe(true)
    expect(matchesLocation(card("33 - Bordeaux", "33", null), "ile-de-france")).toBe(false)
  })

  test("matches remote missions on either spelling", () => {
    expect(matchesLocation(card("Télétravail", null, null), "remote")).toBe(true)
    expect(matchesLocation(card("Télétravail", null, null), "teletravail")).toBe(true)
    expect(matchesLocation(card("75 - Paris", "75", null), "remote")).toBe(false)
  })

  test("jobage keeps recent missions and drops undated ones", () => {
    expect(withinJobage(card(null, null, "2026-07-28"), 7, NOW)).toBe(true)
    expect(withinJobage(card(null, null, "2026-06-01"), 7, NOW)).toBe(false)
    expect(withinJobage(card(null, null, null), 7, NOW)).toBe(false)
    expect(withinJobage(card(null, null, null), 9999, NOW)).toBe(true)
  })
})

describe("skillMatchesQuery", () => {
  const tagged = (...skills: string[]) => ({ skills } as MissionCard)

  test("accepts an exact tag, case- and accent-insensitively", () => {
    expect(skillMatchesQuery(tagged("Node.js", "Angular"), "Node.js")).toBe(true)
    expect(skillMatchesQuery(tagged("GO", "VMware"), "go")).toBe(true)
  })

  test("rejects the portal's related-skill substitution", () => {
    // `competences=Rust` really does come back as C++ missions.
    expect(skillMatchesQuery(tagged("C++", "Linux", "Bash"), "Rust")).toBe(false)
  })

  test("an empty query matches everything", () => {
    expect(skillMatchesQuery(tagged("C++"), "")).toBe(true)
  })
})

describe("URL building", () => {
  test("search maps --query to competences and omits page 1", () => {
    expect(buildUrl({ query: "Node.js", jobage: 9999, page: 1, format: "json" })).toBe(
      "https://www.freelance-informatique.fr/offres-freelance?competences=Node.js",
    )
    expect(buildUrl({ jobage: 9999, page: 3, format: "json" })).toBe(
      "https://www.freelance-informatique.fr/offres-freelance?page=3",
    )
  })

  test("detail resolves a bare reference through the canonical redirect", () => {
    expect(detailUrl("260728C015")).toBe(
      "https://www.freelance-informatique.fr/mission-x-260728C015",
    )
    expect(
      detailUrl("https://www.freelance-informatique.fr/mission-developpeur-java-sur-paris-260728C015"),
    ).toBe("https://www.freelance-informatique.fr/mission-x-260728C015")
    expect(detailUrl("not-a-mission")).toBeNull()
  })
})
