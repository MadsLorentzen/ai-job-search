import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr)
  } catch {
    return {}
  }
}

describe("ats-boards CLI flag validation", () => {
  test("search without --board exits BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", "engineer"])
    expect(result.exitCode).not.toBe(0)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toMatch(/board/)
  })

  test("--jobage non-numeric exits BAD_ARG", async () => {
    const result = await runCLI(["search", "--board", "greenhouse:acme", "--jobage", "foo"])
    expect(result.exitCode).not.toBe(0)
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
  })

  test("unknown flag exits UNKNOWN_FLAG", async () => {
    const result = await runCLI(["search", "--board", "greenhouse:acme", "--facet", "x"])
    expect(result.exitCode).not.toBe(0)
    expect(parsedStderr(result.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("detail without kind:token:id exits BAD_ARG", async () => {
    const result = await runCLI(["detail", "12345"])
    expect(result.exitCode).not.toBe(0)
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
  })
})
