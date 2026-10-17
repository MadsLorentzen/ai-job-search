import { describe, expect, test } from "bun:test"
import { normalizeDetailInput } from "../src/commands/detail.js"
import { cityIdForLocation } from "../src/helpers.js"

describe("Rozee detail input validation", () => {
  test("accepts a permalink slug and a real Rozee detail URL", () => {
    expect(normalizeDetailInput("aiml-intern-lahore-jobs-1906063")).toEqual({
      id: "aiml-intern-lahore-jobs-1906063",
      url: "https://www.rozee.pk/aiml-intern-lahore-jobs-1906063",
    })
    expect(normalizeDetailInput("https://www.rozee.pk/aiml-intern-lahore-jobs-1906063?source=search")?.id)
      .toBe("aiml-intern-lahore-jobs-1906063")
  })

  test("rejects numeric IDs and foreign-host URLs", () => {
    expect(normalizeDetailInput("1906063")).toBeNull()
    expect(normalizeDetailInput("https://jobs.example.com/ai-ml-intern-lahore-jobs-1906063"))
      .toBeNull()
    expect(normalizeDetailInput("https://rozee.pk.evil.test/ai-ml-intern-lahore-jobs-1906063"))
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
