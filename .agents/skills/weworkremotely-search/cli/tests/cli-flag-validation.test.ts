// Flag-validation tests. Every case exits before any network call.
import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

describe("CLI contract", () => {
  test("bare invocation prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("weworkremotely-cli")
  })

  test("help lists the valid category slugs", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("remote-programming-jobs")
  })

  test("an unknown category is rejected, not silently widened to all jobs", async () => {
    const r = await runCLI(["search", "--category", "underwater-basket-weaving"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(JSON.parse(r.stderr).code).toBe("BAD_CATEGORY")
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

  test("detail rejects an unparseable id before fetching", async () => {
    const r = await runCLI(["detail", "ab"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ID")
  })

  for (const flag of ["--limit", "--page", "--jobage"]) {
    test(`${flag} rejects a non-numeric value before fetching`, async () => {
      const r = await runCLI(["search", flag, "abc"])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toBe("")
      const err = JSON.parse(r.stderr)
      expect(err.code).toBe("BAD_ARG")
      expect(err.error).toContain(flag.replace(/^--/, ""))
    })
  }
})
