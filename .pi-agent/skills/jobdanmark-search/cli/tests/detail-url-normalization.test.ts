import { describe, expect, test } from "bun:test"
import { normalizeSlug } from "../src/helpers.js"
import { runCLI } from "./helpers.js"

describe("jobdanmark-search normalizeSlug", () => {
  test("accepts bare slug", () => {
    expect(normalizeSlug("software-udvikler-12345")).toBe("software-udvikler-12345")
    expect(normalizeSlug("  senior_dev_67890  ")).toBe("senior_dev_67890")
  })

  test("extracts slug from full URL with trailing slash", () => {
    expect(normalizeSlug("https://jobdanmark.dk/job/software-udvikler-12345/")).toBe("software-udvikler-12345")
  })

  test("extracts slug from full URL without trailing slash", () => {
    expect(normalizeSlug("https://jobdanmark.dk/job/software-udvikler-12345")).toBe("software-udvikler-12345")
  })

  test("extracts slug from relative URL path", () => {
    expect(normalizeSlug("/job/software-udvikler-12345")).toBe("software-udvikler-12345")
    expect(normalizeSlug("/job/software-udvikler-12345/")).toBe("software-udvikler-12345")
  })

  test("extracts slug from URL with query parameters and hash fragments", () => {
    expect(normalizeSlug("https://jobdanmark.dk/job/software-udvikler-12345?utm_source=test&ref=1")).toBe(
      "software-udvikler-12345",
    )
    expect(normalizeSlug("https://jobdanmark.dk/job/software-udvikler-12345#apply")).toBe(
      "software-udvikler-12345",
    )
  })

  test("rejects empty string and invalid URLs", () => {
    expect(normalizeSlug("")).toBeNull()
    expect(normalizeSlug("   ")).toBeNull()
    expect(normalizeSlug("https://example.com/other/test")).toBeNull()
  })

  test("CLI detail command rejects invalid slug format with BAD_ID", async () => {
    const result = await runCLI(["detail", "https://invalid.com/not-a-job"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ID")
  })
})
