import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

describe("zhaopin CLI contract", () => {
  test("rejects unknown flags before network access", async () => {
    const result = await runCLI(["search", "--query", "Python", "--bogus", "x"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("rejects invalid numeric flags", async () => {
    const result = await runCLI(["search", "--query", "Python", "--limit", "0"])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).code).toBe("BAD_ARG")
  })
})
