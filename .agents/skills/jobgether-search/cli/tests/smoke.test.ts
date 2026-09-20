import { describe, expect, test } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"

// Live smoke tests against the real jobgether.com API. Keep volume low: one
// search call, one detail call.

describe("search (live)", () => {
  test("returns real results for a broad query", async () => {
    const result = await runCLI(["search", "-q", "product manager", "--limit", "5"])
    const body = parseJSON<{ meta: { count: number }; results: Array<{ id: string; title: string; url: string }> }>(result)
    expect(body.results.length).toBeGreaterThan(0)
    for (const r of body.results) {
      expect(r.id).toBeTruthy()
      expect(r.title).toBeTruthy()
      expect(r.url).toMatch(/^https:\/\/jobgether\.com\/offer\//)
    }
  }, 30000)

  test("an invalid enum value is reported as the API's own error, not a crash", async () => {
    const result = await runCLI(["search", "--experience", "senior"])
    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stderr)
    expect(body.code).toBe("INVALID_PARAMETER")
  }, 30000)
})

describe("flag validation", () => {
  test("an unknown flag exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "--bogus-flag", "x"])
    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stderr)
    expect(body.code).toBe("UNKNOWN_FLAG")
  })

  test("detail without an id/url exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stderr)
    expect(body.code).toBe("NO_ID")
  })
})
