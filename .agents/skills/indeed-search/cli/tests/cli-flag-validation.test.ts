import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"
import { normalizeId } from "../src/commands/detail"

// Every case here fails before any request is made, so none touches the network.
function stderrJSON(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr)
}

describe("search flag validation", () => {
  test("an unknown flag exits 1 with UNKNOWN_FLAG", async () => {
    const r = await runCLI(["search", "-q", "ingeniero", "--bogus-flag", "xyz"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("--radius is not supported (robots.txt disallows it) and is rejected, not ignored", async () => {
    const r = await runCLI(["search", "-q", "ingeniero", "--radius", "25"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("no --query and no --location exits 1 with NO_QUERY", async () => {
    const r = await runCLI(["search"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_QUERY")
  })

  test.each(["0", "1.5", "abc"])("--jobage %s exits 1 with BAD_ARG", async (v) => {
    const r = await runCLI(["search", "-q", "x", "--jobage", v])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("--page beyond the robots.txt limit exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "-q", "x", "--page", "11"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("a bad --format exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "-q", "x", "--format", "xml"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })
})

describe("detail", () => {
  test("detail without an id exits 1 with NO_ID", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_ID")
  })

  test("a valid job key exits 1 with DETAIL_UNAVAILABLE and names the robots.txt reason", async () => {
    const r = await runCLI(["detail", "eb247b2ca3c566bf"])
    expect(r.exitCode).toBe(1)
    const err = stderrJSON(r.stderr)
    expect(err.code).toBe("DETAIL_UNAVAILABLE")
    expect(err.error).toContain("robots.txt")
  })

  test("a foreign URL exits 1 with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://evil.com/viewjob?jk=eb247b2ca3c566bf"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ID")
  })

  test("an unknown command exits 1 with BAD_CMD", async () => {
    const r = await runCLI(["frobnicate"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_CMD")
  })
})

describe("normalizeId", () => {
  test.each([
    ["eb247b2ca3c566bf", "eb247b2ca3c566bf"],
    ["EB247B2CA3C566BF", "eb247b2ca3c566bf"],
    ["https://es.indeed.com/viewjob?jk=eb247b2ca3c566bf", "eb247b2ca3c566bf"],
    ["https://es.indeed.com/rc/clk?jk=eb247b2ca3c566bf&bb=abc", "eb247b2ca3c566bf"],
    ["https://www.indeed.com/viewjob?from=serp&jk=eb247b2ca3c566bf", "eb247b2ca3c566bf"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeId(input)).toBe(expected)
  })

  test.each([
    "https://evil.com/viewjob?jk=eb247b2ca3c566bf",
    "https://es.indeed.com.evil.io/viewjob?jk=eb247b2ca3c566bf",
    "https://es.indeed.com@evil.io/viewjob?jk=eb247b2ca3c566bf",
    "https://es.indeed.com/jobs?q=ingeniero",
    "https://es.indeed.com/viewjob?jk=short",
    "abc",
    "",
  ])("rejects %s", (input) => {
    expect(normalizeId(input)).toBeNull()
  })
})
