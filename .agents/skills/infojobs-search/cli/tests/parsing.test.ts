import { describe, expect, test } from "bun:test"
import {
  dv,
  jobageToSinceDate,
  parseDetailResponse,
  parseSearchResponse,
  toProvinceKey,
} from "../src/helpers"

// Shaped after the published API documentation (offer list, API v9).
const OFFER = {
  id: "eb371a01c14f97838d790d19d606ce",
  title: "Ingeniero/a de mantenimiento",
  category: { id: 1, value: "Ingenieros y técnicos" },
  link: "https://www.infojobs.net/toledo/ingeniero-mantenimiento/of-ieb371a01c14f97838d790d19d606ce",
  city: "Illescas",
  province: { id: 45, value: "Toledo" },
  author: { id: "x", name: "ACME INDUSTRIAL", uri: "u" },
  published: "2026-10-15T08:30:00.000+02:00",
  updated: "2026-10-17T09:00:00.000+02:00",
  salaryDescription: "30.000€ - 36.000€ Bruto/año",
  contractType: { id: 8, value: "Indefinido" },
  workDay: { id: 1, value: "Jornada completa" },
  experienceMin: { id: 3, value: "Al menos 2 años" },
  teleworking: { id: 1, value: "Presencial" },
  requirementMin: "Ingeniería Industrial. Inglés B2.",
}

describe("dv", () => {
  test("reads a string, a {value} object, or nothing", () => {
    expect(dv(" x ")).toBe("x")
    expect(dv({ id: 1, value: "Toledo" })).toBe("Toledo")
    expect(dv({ id: 1 })).toBeNull()
    expect(dv(undefined)).toBeNull()
    expect(dv("")).toBeNull()
  })
})

describe("parseSearchResponse", () => {
  test("maps every field of an offer", () => {
    const { cards, total, pages } = parseSearchResponse({ offers: [OFFER], totalResults: 42, totalPages: 3 })
    expect(total).toBe(42)
    expect(pages).toBe(3)
    expect(cards).toEqual([
      {
        id: "eb371a01c14f97838d790d19d606ce",
        title: "Ingeniero/a de mantenimiento",
        company: "ACME INDUSTRIAL",
        location: "Illescas, Toledo",
        date: "2026-10-15",
        url: OFFER.link,
        salary: "30.000€ - 36.000€ Bruto/año",
        contract: "Indefinido",
        workday: "Jornada completa",
        experience: "Al menos 2 años",
        teleworking: "Presencial",
        summary: "Ingeniería Industrial. Inglés B2.",
      },
    ])
  })

  test("falls back to the updated date and to a constructed URL", () => {
    const { cards } = parseSearchResponse({ offers: [{ id: "abc123", title: "T", updated: "2026-10-01T00:00:00Z" }] })
    expect(cards[0].date).toBe("2026-10-01")
    expect(cards[0].url).toBe("https://www.infojobs.net/of-iabc123")
  })

  test("a city equal to the province is not repeated", () => {
    const { cards } = parseSearchResponse({
      offers: [{ id: "a", title: "T", city: "Toledo", province: { value: "Toledo" } }],
    })
    expect(cards[0].location).toBe("Toledo")
  })

  test("an offer without id or title is skipped without breaking the rest; missing values are null", () => {
    const { cards } = parseSearchResponse({ offers: [{ title: "no id" }, { id: "z" }, null, { id: "ok", title: "Operario" }] })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ id: "ok", company: null, location: null, date: null, salary: null })
  })

  test("an empty list is a valid empty result", () => {
    expect(parseSearchResponse({ offers: [], totalResults: 0 }).cards).toEqual([])
  })

  test("a response with no offers list is PARSE_FAILED, not 'zero jobs'", () => {
    expect(() => parseSearchResponse({ message: "oops" })).toThrow(expect.objectContaining({ code: "PARSE_FAILED" }))
  })

  test("accepts the `items` spelling the documentation also shows", () => {
    expect(parseSearchResponse({ items: [OFFER] }).cards).toHaveLength(1)
  })
})

describe("parseDetailResponse", () => {
  const DETAIL = {
    id: "eb371a01c14f97838d790d19d606ce",
    title: "Ingeniero/a de mantenimiento",
    description: "Mantenimiento de línea.\r\nTurnos.",
    minRequirements: "Ingeniería Industrial",
    desiredRequirements: "Inglés",
    creationDate: "2026-10-10T10:00:00.000+02:00",
    updateDate: "2026-10-15T10:00:00.000+02:00",
    showPay: true,
    minPay: { amount: 30000, amountValue: "30.000 €", periodValue: "Bruto/año" },
    maxPay: { amount: 36000, amountValue: "36.000 €", periodValue: "Bruto/año" },
    link: "https://www.infojobs.net/x/of-ieb371a01c14f97838d790d19d606ce",
    active: true,
    profile: { name: "ACME INDUSTRIAL" },
    city: "Illescas",
    province: { value: "Toledo" },
    contractType: { value: "Indefinido" },
    journey: { value: "Completa" },
    experienceMin: { value: "Al menos 2 años" },
    studiesMin: { value: "Ingeniero Técnico" },
    skillsList: [{ skill: "AutoCAD" }, { skill: "SolidWorks" }],
  }

  test("maps the documented fields", () => {
    expect(parseDetailResponse(DETAIL, "eb371a01c14f97838d790d19d606ce")).toEqual({
      id: "eb371a01c14f97838d790d19d606ce",
      title: "Ingeniero/a de mantenimiento",
      company: "ACME INDUSTRIAL",
      location: "Illescas, Toledo",
      date: "2026-10-10",
      deadline: null,
      url: DETAIL.link,
      description: "Mantenimiento de línea.\nTurnos.",
      minRequirements: "Ingeniería Industrial",
      desiredRequirements: "Inglés",
      salary: "30.000 € Bruto/año - 36.000 € Bruto/año",
      contract: "Indefinido",
      workday: "Completa",
      experience: "Al menos 2 años",
      studies: "Ingeniero Técnico",
      skills: ["AutoCAD", "SolidWorks"],
      active: true,
    })
  })

  test("showPay false hides the salary", () => {
    expect(parseDetailResponse({ ...DETAIL, showPay: false }, "x")!.salary).toBeNull()
  })

  test("returns null for a non-offer body", () => {
    expect(parseDetailResponse({ error: "313" }, "x")).toBeNull()
    expect(parseDetailResponse(null, "x")).toBeNull()
  })
})

describe("jobageToSinceDate", () => {
  test.each([
    [1, "_24_HOURS"],
    [2, "_7_DAYS"],
    [7, "_7_DAYS"],
    [14, "_15_DAYS"],
    [15, "_15_DAYS"],
    [30, null],
    [9999, null],
  ])("%d days -> %p", (days, expected) => {
    expect(jobageToSinceDate(days)).toBe(expected as string | null)
  })
})

describe("toProvinceKey", () => {
  test.each([
    ["Toledo", "toledo"],
    ["  Ciudad Real ", "ciudad-real"],
    ["Málaga", "malaga"],
    ["A Coruña", "a-coruna"],
    ["Santa Cruz de Tenerife", "santa-cruz-de-tenerife"],
  ])("%s -> %s", (input, expected) => {
    expect(toProvinceKey(input)).toBe(expected)
  })
})
