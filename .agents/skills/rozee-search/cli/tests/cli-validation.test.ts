import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

describe("CLI validation", () => {
  test("rejects unsupported posting-age filters with JSON stderr", async () => {
    const result = await runCLI(["search", "-q", "Analyst Intern", "--jobage", "14"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "UNSUPPORTED_FILTER" })
  })

  test("rejects unknown flags instead of silently ignoring them", async () => {
    const result = await runCLI(["search", "-q", "Analyst Intern", "--unsupported"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "UNKNOWN_FLAG" })
  })

  test("rejects a foreign detail URL before making a request", async () => {
    const result = await runCLI(["detail", "https://jobs.example.com/sample-role-islamabad-jobs-123456"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "BAD_ID" })
  })
})
