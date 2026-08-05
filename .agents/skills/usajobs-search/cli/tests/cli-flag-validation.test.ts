// Flag-validation tests. Every case exits before any network call.
// These deliberately run WITHOUT credentials in the environment, which also
// pins the ordering guarantee: a bad flag is reported as a bad flag, not
// masked by the missing-key error.
import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

describe("CLI contract", () => {
  test("bare invocation prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("usajobs-cli")
  })

  test("help explains the API key requirement", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("USAJOBS_API_KEY")
  })

  test("an unknown command errors as JSON on stderr", async () => {
    const r = await runCLI(["frobnicate"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_CMD")
  })

  test("detail without an id errors as JSON on stderr", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NO_ID")
  })

  test("--remote and --onsite together are rejected", async () => {
    const r = await runCLI(["search", "--remote", "--onsite"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG")
  })

  for (const flag of ["--limit", "--page", "--jobage"]) {
    test(`${flag} rejects a non-numeric value, ahead of the credentials check`, async () => {
      const r = await runCLI(["search", flag, "abc"])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toBe("")
      const err = JSON.parse(r.stderr)
      // Must be BAD_ARG, not NO_CREDENTIALS — a typo should read as a typo.
      expect(err.code).toBe("BAD_ARG")
      expect(err.error).toContain(flag.replace(/^--/, ""))
    })
  }
})
