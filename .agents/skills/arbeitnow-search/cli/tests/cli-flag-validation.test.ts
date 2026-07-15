import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

describe("flag validation", () => {
  test("unknown command exits 1 with JSON error on stderr", async () => {
    const result = await runCLI(["frobnicate"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_CMD")
  })

  test("non-numeric --jobage exits 1", async () => {
    const result = await runCLI(["search", "--jobage", "soon"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("--remote and --onsite together exit 1", async () => {
    const result = await runCLI(["search", "--remote", "--onsite"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("detail without id exits 1", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("NO_ID")
  })
})
