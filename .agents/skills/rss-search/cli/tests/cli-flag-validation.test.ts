import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr)
  } catch {
    return {}
  }
}

describe("rss CLI flag validation", () => {
  test("search without --feed exits BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", "engineer"])
    expect(result.exitCode).not.toBe(0)
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
  })

  test("--jobage non-numeric exits BAD_ARG", async () => {
    const result = await runCLI(["search", "--feed", "https://example.com/feed.xml", "--jobage", "nope"])
    expect(result.exitCode).not.toBe(0)
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
  })
})
