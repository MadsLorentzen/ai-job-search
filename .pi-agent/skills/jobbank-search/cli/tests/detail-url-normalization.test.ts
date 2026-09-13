import { describe, expect, test } from "bun:test"
import { normalizeJobId } from "../src/helpers.js"
import { runCLI } from "./helpers.js"

describe("jobbank-search normalizeJobId", () => {
  test("accepts bare numeric ID", () => {
    expect(normalizeJobId("304212")).toBe("304212")
    expect(normalizeJobId("  12345  ")).toBe("12345")
  })

  test("extracts ID from full URL with trailing slash", () => {
    expect(normalizeJobId("https://jobbank.dk/job/304212/")).toBe("304212")
  })

  test("extracts ID from full URL without trailing slash", () => {
    expect(normalizeJobId("https://jobbank.dk/job/304212")).toBe("304212")
  })

  test("extracts ID from full URL with company/role slug segments", () => {
    expect(normalizeJobId("https://jobbank.dk/job/304212/acme-corp/software-developer")).toBe("304212")
    expect(normalizeJobId("https://jobbank.dk/job/304212/acme-corp/software-developer/")).toBe("304212")
  })

  test("extracts ID from URL with query parameters and hash fragments", () => {
    expect(normalizeJobId("https://jobbank.dk/job/304212?ref=search&page=1")).toBe("304212")
    expect(normalizeJobId("https://jobbank.dk/job/304212#apply")).toBe("304212")
  })

  test("rejects invalid non-numeric strings and unrelated URLs", () => {
    expect(normalizeJobId("abc")).toBeNull()
    expect(normalizeJobId("https://example.com/other/12345")).toBeNull()
    expect(normalizeJobId("")).toBeNull()
  })

  test("CLI detail command rejects invalid ID format with BAD_ID", async () => {
    const result = await runCLI(["detail", "invalid-id-format"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ID")
  })
})
