// Flag-validation tests. Every case exits before any network call.
import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

describe("CLI contract", () => {
  test("bare invocation prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("lever-cli")
  })

  test("--help exits 0 with usage on stdout", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("SEARCH FLAGS")
  })

  test("search without --company errors — Lever has no cross-company search", async () => {
    const r = await runCLI(["search", "-q", "engineer"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(JSON.parse(r.stderr).code).toBe("NO_COMPANY")
  })

  test("--remote rejects a mode outside remote|hybrid|onsite", async () => {
    const r = await runCLI(["search", "-c", "palantir", "--remote", "underwater"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG")
  })

  test("a bare --remote is accepted as 'remote', not silently ignored", async () => {
    // Previously this parsed to boolean true, failed the `typeof === "string"`
    // check, and skipped the filter — returning onsite jobs with no warning.
    // --limit abc still errors, which proves we got past flag interpretation
    // without --remote being rejected, all without making a network call.
    const r = await runCLI(["search", "-c", "palantir", "--remote", "--limit", "abc"])
    expect(r.exitCode).toBe(1)
    const err = JSON.parse(r.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("limit")
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

  test("detail with a bare UUID but no site errors before fetching", async () => {
    const r = await runCLI(["detail", "ac978161-6f46-4f6b-ad9e-a258e642751c"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ID")
  })

  for (const flag of ["--limit", "--page", "--jobage"]) {
    test(`${flag} rejects a non-numeric value before fetching`, async () => {
      const r = await runCLI(["search", "-c", "palantir", flag, "abc"])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toBe("")
      const err = JSON.parse(r.stderr)
      expect(err.code).toBe("BAD_ARG")
      expect(err.error).toContain(flag.replace(/^--/, ""))
    })
  }
})
