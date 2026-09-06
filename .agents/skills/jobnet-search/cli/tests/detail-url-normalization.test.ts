import { describe, expect, test } from "bun:test"
import { normalizeJobId } from "../src/helpers.js"
import { runCLI } from "./helpers.js"

describe("jobnet-search normalizeJobId", () => {
  test("accepts bare numeric ID", () => {
    expect(normalizeJobId("6123456")).toBe("6123456")
    expect(normalizeJobId("  6123456  ")).toBe("6123456")
  })

  test("accepts alphanumeric ID", () => {
    expect(normalizeJobId("E123456")).toBe("E123456")
    expect(normalizeJobId("job_12345")).toBe("job_12345")
  })

  test("extracts ID from /find-job/ URL with trailing slash", () => {
    expect(normalizeJobId("https://jobnet.dk/find-job/6123456/")).toBe("6123456")
  })

  test("extracts ID from /find-job/ URL without trailing slash", () => {
    expect(normalizeJobId("https://jobnet.dk/find-job/6123456")).toBe("6123456")
  })

  test("extracts ID from /find-job/detaljer/ URL", () => {
    expect(normalizeJobId("https://jobnet.dk/find-job/detaljer/6123456")).toBe("6123456")
    expect(normalizeJobId("https://jobnet.dk/find-job/detaljer/6123456/")).toBe("6123456")
  })

  test("extracts ID from /FindJob/JobAdDetails/ URL", () => {
    expect(normalizeJobId("https://jobnet.dk/FindJob/JobAdDetails/6123456")).toBe("6123456")
  })

  test("extracts ID from legacy /CV/FindWork/Details/ URL", () => {
    expect(normalizeJobId("https://job.jobnet.dk/CV/FindWork/Details/6123456")).toBe("6123456")
  })

  test("extracts ID from URL with query parameters and hash fragments", () => {
    expect(normalizeJobId("https://jobnet.dk/find-job/6123456?ref=share&utm=test")).toBe("6123456")
    expect(normalizeJobId("https://jobnet.dk/find-job/6123456#main")).toBe("6123456")
  })

  test("rejects empty string and invalid URLs", () => {
    expect(normalizeJobId("")).toBeNull()
    expect(normalizeJobId("   ")).toBeNull()
    expect(normalizeJobId("https://example.com/other/6123456")).toBeNull()
  })

  test("CLI detail command rejects invalid ID format with BAD_ID", async () => {
    const result = await runCLI(["detail", "https://invalid.com/not-jobnet"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ID")
  })
})
