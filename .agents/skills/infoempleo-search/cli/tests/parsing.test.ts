import { describe, expect, test } from "bun:test"
import {
  decodeHtmlEntities,
  jobageToDias,
  parseJobCards,
  parseJobDetail,
  parseTotal,
  relativeToDate,
} from "../src/helpers"

const NOW = new Date("2026-10-18T12:00:00Z")

// Mirrors the live markup: real offers, a duplicate of the same offer, an ad
// slot and a course module that reuse the offerblock class, and a card with
// no company logo.
const PAGE = `
<p class="dcell">Mostrando 1-20 de 1.234 ofertas
<ul class="mt15 positions">
<li class="offerblock"><h2 class="title mb15"><a href="/ofertasdetrabajo/ingenieroa-industrial-junior/caceres/3204931/"> Ingeniero/a Industrial Junior </a></h2>
<p class="trunkat mb15">Grado en Ingenier&#237;a Industrial. Nivel alto de ingl&#233;s.<p class="small extra-data mb15">No se requiere experiencia | contrato de duraci&#243;n determinada | salario 22.000-24.000&#8364;
<div class="logoplusname mb15"><img class="logo" src="x.jpg" alt="MICHAEL PAGE"> <span class="extra-data">MICHAEL PAGE</span></div><div class="clearfix"></div>
<p class="extra-data"><span> <svg class="icon icon-map-marker"><use xlink:href="#icon-map-marker"></use></svg> </span> C&#225;ceres
<p class="block mt10 mb5"><span> <svg class="icon icon-clock"><use xlink:href="#icon-clock"></use></svg> </span> <span class="extra-data">Hace 18 horas &nbsp; <span class="update_offer">(Actualizada)</span></span><div class="clearfix"></div>
<li class="offerblock"><h2 class="title mb15"><a href="/ofertasdetrabajo/ingenieroa-industrial-junior/caceres/3204931/"> Ingeniero/a Industrial Junior </a></h2>
<p class="trunkat mb15">duplicate of the first card
<li class="offerblock"><h2 class="title mb15"><a href="/ofertasdetrabajo/delineante/toledo/3100001/">Delineante &amp; Proyectista</a></h2>
<p class="small extra-data mb15">jornada completa
<p class="extra-data"><span> <svg class="icon icon-map-marker"></svg> </span> Toledo
<p class="block mt10 mb5"><span> <svg class="icon icon-clock"></svg> </span> <span class="extra-data">Hace 3 d&#237;as &nbsp; </span>
<li class="offerblock"><div id="contenedor_robapaginas_1_mobile" class="robapaginas"></div>
<li class="offerblock"><p class="title ellipsis">Curso de soldadura</p><input type="hidden" id="hdnPosicionCurso" value="1">
</ul>`

describe("parseJobCards", () => {
  const cards = parseJobCards(PAGE, NOW)

  test("keeps only real offers and drops repeats, ads and courses", () => {
    expect(cards.map((c) => c.id)).toEqual(["3204931", "3100001"])
  })

  test("extracts and decodes every field", () => {
    expect(cards[0]).toEqual({
      id: "3204931",
      title: "Ingeniero/a Industrial Junior",
      company: "MICHAEL PAGE",
      location: "Cáceres",
      date: "2026-10-17",
      url: "https://www.infoempleo.com/ofertasdetrabajo/ingenieroa-industrial-junior/caceres/3204931/",
      summary: "No se requiere experiencia | contrato de duración determinada | salario 22.000-24.000€",
      snippet: "Grado en Ingeniería Industrial. Nivel alto de inglés.",
    })
  })

  test("a card without a logo block has a null company, and decodes &amp;", () => {
    expect(cards[1].company).toBeNull()
    expect(cards[1].title).toBe("Delineante & Proyectista")
    expect(cards[1].date).toBe("2026-10-15")
  })

  test("a page with no offers parses to an empty list", () => {
    expect(parseJobCards("<html></html>", NOW)).toEqual([])
  })
})

describe("decodeHtmlEntities", () => {
  test("decodes named Spanish entities and does not double-decode &amp;", () => {
    expect(decodeHtmlEntities("Ingenier&iacute;a &amp; Dise&ntilde;o &euro;")).toBe("Ingeniería & Diseño €")
    expect(decodeHtmlEntities("&amp;iacute;")).toBe("&iacute;")
    expect(decodeHtmlEntities("&unknown; &#233;")).toBe("&unknown; é")
  })
})

describe("parseTotal", () => {
  test("reads the thousands-separated total", () => {
    expect(parseTotal(PAGE)).toBe(1234)
  })
  test("is null when the page has no count", () => {
    expect(parseTotal("<html></html>")).toBeNull()
  })
})

describe("relativeToDate", () => {
  test.each([
    ["Hace 18 horas", "2026-10-17"],
    ["Hace 42 horas", "2026-10-16"],
    ["Hace 3 d&#237;as", "2026-10-15"],
    ["Hace 2 semanas", "2026-10-04"],
    ["Hoy", "2026-10-18"],
    ["Ayer", "2026-10-17"],
  ])("%s -> %s", (text, expected) => {
    expect(relativeToDate(text, NOW)).toBe(expected)
  })

  test("an open-ended age is a lower bound, not a date", () => {
    expect(relativeToDate("Hace m&#225;s de 100 d&#237;as", NOW)).toBeNull()
  })
})

describe("jobageToDias", () => {
  test.each([
    [1, 1],
    [2, 7],
    [7, 7],
    [14, 15],
    [15, 15],
    [30, null],
    [9999, null],
  ])("%d days -> %p", (days, expected) => {
    expect(jobageToDias(days)).toBe(expected as number | null)
  })
})

describe("parseJobDetail", () => {
  const posting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Ingeniero Industrial Eléctrico SENIOR",
    datePosted: "2026-10-01",
    validThrough: "2026-10-31",
    description: "<p>Funciones:<br>- Coordinar equipos</p><h3>Requisitos</h3><p>- Ingeniería Industrial &amp; colegiación</p>",
    employmentType: "OTHER",
    workHours: "Jornada completa",
    experienceRequirements: "No se requiere experiencia",
    industry: "Ingeniería y producción",
    hiringOrganization: { "@type": "Organization", name: "MICHAEL PAGE" },
    jobLocation: { address: { addressLocality: "Badalona", addressRegion: "Barcelona" } },
    baseSalary: { currency: "EUR", value: { minValue: 40000, maxValue: 42000, unitText: "YEAR" } },
  }
  const html = `<script type="application/ld+json">{not json</script>
<script type="application/ld+json">${JSON.stringify({ "@type": "BreadcrumbList" })}</script>
<script type="application/ld+json">${JSON.stringify(posting)}</script>`

  test("reads the JobPosting block and skips malformed or unrelated blocks", () => {
    const job = parseJobDetail(html, "3202937")!
    expect(job.title).toBe("Ingeniero Industrial Eléctrico SENIOR")
    expect(job.company).toBe("MICHAEL PAGE")
    expect(job.location).toBe("Badalona, Barcelona")
    expect(job.date).toBe("2026-10-01")
    expect(job.deadline).toBe("2026-10-31")
    expect(job.salary).toBe("40000-42000€/año")
  })

  test("converts the HTML description to readable lines", () => {
    const job = parseJobDetail(html, "3202937")!
    expect(job.description).toBe("Funciones:\n- Coordinar equipos\nRequisitos\n- Ingeniería Industrial & colegiación")
  })

  test("returns null when the page carries no JobPosting", () => {
    expect(parseJobDetail("<html>no data</html>", "1")).toBeNull()
  })
})
