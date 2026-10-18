import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

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

  test("--remote is not supported and is rejected rather than ignored", async () => {
    const r = await runCLI(["search", "-q", "ingeniero", "--remote", "remote"])
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

  test("a bad --format exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "-q", "x", "--format", "xml"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })
})

describe("detail and dispatch", () => {
  test("detail without an id exits 1 with NO_ID", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_ID")
  })

  test("detail with a foreign URL exits 1 with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://evil.com/ofertasdetrabajo/x/y/3202937/"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ID")
  })

  test("an unknown command exits 1 with BAD_CMD", async () => {
    const r = await runCLI(["frobnicate"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_CMD")
  })
})
