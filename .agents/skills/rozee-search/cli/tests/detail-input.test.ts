import { describe, expect, test } from "bun:test"
import { normalizeDetailInput } from "../src/commands/detail.js"
import { cityIdForLocation } from "../src/helpers.js"

describe("Rozee detail input validation", () => {
  test("accepts a permalink slug and a canonical-host detail URL", () => {
    expect(normalizeDetailInput("sample-role-islamabad-jobs-123456")).toEqual({
      id: "sample-role-islamabad-jobs-123456",
      url: "https://www.rozee.pk/sample-role-islamabad-jobs-123456",
    })
    expect(normalizeDetailInput("https://www.rozee.pk/sample-role-islamabad-jobs-123456?source=search")?.id)
      .toBe("sample-role-islamabad-jobs-123456")
  })

  test("rejects numeric IDs and foreign-host URLs", () => {
    expect(normalizeDetailInput("1906063")).toBeNull()
    expect(normalizeDetailInput("https://jobs.example.com/sample-role-islamabad-jobs-123456"))
      .toBeNull()
    expect(normalizeDetailInput("https://rozee.pk.evil.test/sample-role-islamabad-jobs-123456"))
      .toBeNull()
  })
})

describe("Rozee city mapping", () => {
  test("normalizes supported Pakistan city strings", () => {
    expect(cityIdForLocation("Lahore, Pakistan")).toBe("1185")
    expect(cityIdForLocation("Karachi")).toBe("1184")
    expect(cityIdForLocation("Unknown City")).toBeNull()
  })
})
