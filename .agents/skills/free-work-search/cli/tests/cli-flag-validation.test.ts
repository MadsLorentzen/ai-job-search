import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

/** Every error path must write JSON to stderr and exit 1 (never to stdout). */
function expectJsonError(r: { stdout: string; stderr: string; exitCode: number }, code: string) {
  expect(r.exitCode).toBe(1)
  expect(r.stdout).toBe("")
  const parsed = JSON.parse(r.stderr)
  expect(parsed.code).toBe(code)
  expect(typeof parsed.error).toBe("string")
}

describe("cli flag validation", () => {
  test("no command prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })

  test("--help prints help and exits 0", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("SEARCH FLAGS")
  })

  test("unknown command errors", async () => {
    expectJsonError(await runCLI(["frobnicate"]), "BAD_CMD")
  })

  test("non-numeric --limit errors", async () => {
    expectJsonError(await runCLI(["search", "--limit", "many"]), "BAD_ARG")
  })

  test("non-numeric --jobage errors", async () => {
    expectJsonError(await runCLI(["search", "--jobage", "recent"]), "BAD_ARG")
  })

  test("unknown --contract value errors", async () => {
    expectJsonError(await runCLI(["search", "--contract", "cdi"]), "BAD_ARG")
  })

  test("unknown --remote value errors", async () => {
    expectJsonError(await runCLI(["search", "--remote", "hybrid"]), "BAD_ARG")
  })

  test("detail with no argument errors", async () => {
    expectJsonError(await runCLI(["detail"]), "NO_ID")
  })

  test("detail with a bare numeric id errors with guidance", async () => {
    const r = await runCLI(["detail", "656630"])
    expectJsonError(r, "BAD_ID")
    expect(JSON.parse(r.stderr).error).toContain("slug")
  })
})
