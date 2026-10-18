import { describe, expect, test } from "bun:test"
import { normalizeId } from "../src/commands/detail"

describe("normalizeId", () => {
  test.each([
    ["3202937", "3202937"],
    ["  3202937 ", "3202937"],
    ["https://www.infoempleo.com/ofertasdetrabajo/ingeniero/badalona/3202937/", "3202937"],
    ["https://www.infoempleo.com/ofertasdetrabajo/ingeniero/badalona/3202937", "3202937"],
    ["infoempleo.com/ofertasdetrabajo/x/y/3202937/", "3202937"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeId(input)).toBe(expected)
  })

  test.each([
    "https://evil.com/ofertasdetrabajo/x/y/3202937/",
    "https://infoempleo.com.evil.io/ofertasdetrabajo/x/y/3202937/",
    "https://infoempleo.com@evil.io/ofertasdetrabajo/x/y/3202937/",
    "https://www.infoempleo.com/trabajo/en_toledo/",
    "https://www.infoempleo.com/ofertasdetrabajo/3202937/",
    "abc",
    "12",
    "",
  ])("rejects %s", (input) => {
    expect(normalizeId(input)).toBeNull()
  })
})
