import { describe, expect, test } from "bun:test"
import {
  filterCards,
  fold,
  parseJobCards,
  parseJobDetail,
  spanishDateToIso,
  type JobCard,
} from "../src/helpers"

const LIST = `
<section class="bolsa-ultimas" aria-labelledby="bolsa-ultimas-titulo">
<h2 id="bolsa-ultimas-titulo">Últimas ofertas de empleo</h2>
<article class="bolsa-oferta">
<h3><a href="https://www.ingenieros.es/bolsa_de_trabajo/detalles_oferta/3511">Health and Safety Manager Internacional</a></h3>
<p><strong>Fecha:</strong> 16/10/2026 <span class="bolsa-separador">·</span> <strong>Lugar:</strong> Saint Marcouf</p>
<p><strong>Empresa:</strong> <a href="https://www.ingenieros.es/bolsa_de_trabajo/detalles_empresa/261">Shoots Selecci&oacute;n Alemania</a></p>
</article>
<article class="bolsa-oferta">
<h3><a href="https://www.ingenieros.es/bolsa_de_trabajo/detalles_oferta/3509">Ingeniero/a proyectos industriales</a></h3>
<p><strong>Fecha:</strong> 02/10/2026 <span class="bolsa-separador">·</span> <strong>Lugar:</strong> Valencia</p>
<p><strong>Empresa:</strong> <a href="https://www.ingenieros.es/bolsa_de_trabajo/detalles_empresa/1262">Grupotec</a></p>
</article>
<article class="bolsa-oferta">
<h3>no link here</h3>
</article>
<article class="bolsa-oferta">
<h3><a href="https://www.ingenieros.es/bolsa_de_trabajo/detalles_oferta/3500">Sin empresa ni fecha</a></h3>
</article>
</section>`

describe("spanishDateToIso", () => {
  test.each([
    ["16/10/2026", "2026-10-16"],
    ["2/1/2026", "2026-01-02"],
    ["  Publicada el 05/03/2026 ", "2026-03-05"],
  ])("%s -> %s", (input, expected) => {
    expect(spanishDateToIso(input)).toBe(expected)
  })

  test.each(["", "31/02/2026", "2026-10-16", "hoy"])("%p is not a date", (input) => {
    expect(spanishDateToIso(input)).toBeNull()
  })
})

describe("fold", () => {
  test("strips accents and lowercases", () => {
    expect(fold("Producción INGENIERÍA Ñandú")).toBe("produccion ingenieria nandu")
  })
})

describe("parseJobCards", () => {
  const cards = parseJobCards(LIST)

  test("parses every well-formed card and skips the one with no offer link", () => {
    expect(cards.map((c) => c.id)).toEqual(["3511", "3509", "3500"])
  })

  test("extracts and decodes the fields", () => {
    expect(cards[0]).toEqual({
      id: "3511",
      title: "Health and Safety Manager Internacional",
      company: "Shoots Selección Alemania",
      location: "Saint Marcouf",
      date: "2026-10-16",
      url: "https://www.ingenieros.es/bolsa_de_trabajo/detalles_oferta/3511",
    })
  })

  test("missing company, place and date become null", () => {
    expect(cards[2]).toMatchObject({ company: null, location: null, date: null })
  })

  test("a page with no offers parses to an empty list", () => {
    expect(parseJobCards("<html></html>")).toEqual([])
  })
})

describe("filterCards", () => {
  const cards: JobCard[] = [
    { id: "1", title: "Ingeniero/a proyectos industriales", company: "Grupotec", location: "Valencia", date: "2026-10-02", url: "u1" },
    { id: "2", title: "Jefe de Producción", company: "Acme", location: "Toledo", date: "2026-09-01", url: "u2" },
    { id: "3", title: "Delineante", company: null, location: null, date: null, url: "u3" },
  ]
  const NOW = new Date("2026-10-18T12:00:00Z")
  const ids = (r: JobCard[]) => r.map((c) => c.id)

  test("no filters keeps everything", () => {
    expect(ids(filterCards(cards, { jobage: 9999 }, NOW))).toEqual(["1", "2", "3"])
  })

  test("every query word must match, accent- and case-insensitively, as a substring", () => {
    expect(ids(filterCards(cards, { query: "INGENIERO industrial", jobage: 9999 }, NOW))).toEqual(["1"])
    expect(ids(filterCards(cards, { query: "produccion", jobage: 9999 }, NOW))).toEqual(["2"])
    expect(ids(filterCards(cards, { query: "ingeniero soldador", jobage: 9999 }, NOW))).toEqual([])
  })

  test("the query also matches the company", () => {
    expect(ids(filterCards(cards, { query: "grupotec", jobage: 9999 }, NOW))).toEqual(["1"])
  })

  test("location must appear in the offer's place; an offer with no place cannot match", () => {
    expect(ids(filterCards(cards, { location: "toledo", jobage: 9999 }, NOW))).toEqual(["2"])
  })

  test("jobage drops older dated offers but keeps undated ones", () => {
    expect(ids(filterCards(cards, { jobage: 30 }, NOW))).toEqual(["1", "3"])
    expect(ids(filterCards(cards, { jobage: 60 }, NOW))).toEqual(["1", "2", "3"])
  })

  test("an offer dated today survives --jobage 1", () => {
    const today: JobCard[] = [{ ...cards[0], date: "2026-10-18" }]
    expect(ids(filterCards(today, { jobage: 1 }, NOW))).toEqual(["1"])
  })
})

describe("parseJobDetail", () => {
  const DETAIL = `
<article class="bolsa-detalle">
<header class="bolsa-detalle-cabecera">
  <span class="bolsa-detalle-etiqueta">Oferta de empleo</span>
  <h2>Ingeniero/a proyectos industriales</h2>
  <p class="bolsa-detalle-fecha">Publicada el 02/10/2026</p>
</header>
<section class="bolsa-detalle-seccion" aria-labelledby="bolsa-empresa"><h3 id="bolsa-empresa">La empresa</h3>
  <p><span style="color:#5890A8">Fecha de la oferta:</span> 02/10/2026</p>
  <p><span style="color:#5890A8">Nombre de la empresa:</span> Grupotec</p>
</section>
<section class="bolsa-detalle-seccion" aria-labelledby="bolsa-puesto"><h3 id="bolsa-puesto">Descripci&oacute;n de la oferta</h3>
  <p><span style="color:#5890A8">Puesto vacante:</span> Ingeniero/a proyectos industriales</p>
  <p><span style="color:#5890A8">Provincia:</span> Valencia</p>
  <p><span style="color:#5890A8">Lugar del trabajo:</span> Valencia</p>
  <p><span style="color:#5890A8">Sector:</span> Construcci&oacute;n</p>
  <p><span style="color:#5890A8">Nivel:</span> Empleado</p>
  <div class="bolsa-detalle-texto"><h4>Descripci&oacute;n de la oferta</h4><div><p>
	Buscamos un/a Ingeniero/a.</p>
<p>
	Dise&ntilde;o y c&aacute;lculo.</p></div></div>
</section>
<section class="bolsa-detalle-seccion" aria-labelledby="bolsa-requisitos"><h3 id="bolsa-requisitos">Requisitos</h3>
  <p><span style="color:#5890A8">Estudios m&iacute;nimos:</span> Ingeniero T&eacute;cnico</p>
  <p><span style="color:#5890A8">Experiencia m&iacute;nima:</span> 2 a&ntilde;os</p>
  <div class="bolsa-detalle-texto"><h4>Requisitos m&iacute;nimos</h4><div><p>
	Colegiado/a.</p></div></div>
  <div class="bolsa-detalle-texto"><h4>Requisitos deseados</h4><div><p>
	Ingl&eacute;s.</p>
</div></div>
</section>
<section class="bolsa-detalle-seccion" aria-labelledby="bolsa-contrato"><h3 id="bolsa-contrato">Contrato</h3>
  <p><span style="color:#5890A8">Tipo de contrato:</span> Indefinido</p>
  <p><span style="color:#5890A8">Jornada laboral:</span> Completa</p>
  <p><span style="color:#5890A8">Salario (&euro; brutos/a&ntilde;o):</span> A negociar</p>
</section>
</article>`

  test("reads the header, labelled fields and text blocks", () => {
    const job = parseJobDetail(DETAIL, "3509")!
    expect(job).toMatchObject({
      id: "3509",
      title: "Ingeniero/a proyectos industriales",
      company: "Grupotec",
      location: "Valencia",
      province: "Valencia",
      date: "2026-10-02",
      deadline: null,
      sector: "Construcción",
      level: "Empleado",
      contract: "Indefinido",
      workday: "Completa",
      salary: "A negociar",
      minStudies: "Ingeniero Técnico",
      minExperience: "2 años",
      description: "Buscamos un/a Ingeniero/a.\nDiseño y cálculo.",
      minRequirements: "Colegiado/a.",
      desiredRequirements: "Inglés.",
    })
  })

  test("returns null when the page is not an offer", () => {
    expect(parseJobDetail("<html><h1>Error</h1></html>", "1")).toBeNull()
  })
})
