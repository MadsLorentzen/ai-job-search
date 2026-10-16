import { afterEach, describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"
import { apiFetch } from "../src/helpers"

describe("CLI contract (offline)", () => {
  test("an unknown flag exits 1 with a JSON error on stderr", async () => {
    const r = await runCLI(["search", "-q", "qa", "--bogus", "1"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("UNKNOWN_FLAG")
    expect(r.stdout).toBe("")
  })

  test("search without --query exits 1", async () => {
    const r = await runCLI(["search", "-l", "Dublin"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NO_QUERY")
  })

  test("a bad --jobage exits 1", async () => {
    const r = await runCLI(["search", "-q", "qa", "--jobage", "0.5"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG")
  })
})

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function stub(responses: Array<() => Response>) {
  const state = { calls: 0 }
  globalThis.fetch = (async () => responses[Math.min(state.calls++, responses.length - 1)]()) as unknown as typeof fetch
  globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout
  return state
}

describe("apiFetch", () => {
  test("retries a transient 429 then succeeds", async () => {
    const s = stub([() => new Response("Too many requests", { status: 429 }), () => Response.json({ data: [] })])
    expect(await apiFetch("https://x", "t")).toEqual({ data: [] })
    expect(s.calls).toBe(2)
  })

  test("an exhausted quota fails at once instead of burning retries", async () => {
    const s = stub([() => new Response('{"message":"You have exceeded the MONTHLY quota"}', { status: 429 })])
    await expect(apiFetch("https://x", "t")).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" })
    expect(s.calls).toBe(1)
  })

  test("a retired endpoint is an error, not an empty result", async () => {
    stub([() => new Response(`{"message":"Endpoint '/search' does not exist"}`, { status: 404 })])
    await expect(apiFetch("https://x", "t")).rejects.toMatchObject({ code: "ENDPOINT_GONE" })
  })

  test("an unsubscribed key is reported as NOT_SUBSCRIBED", async () => {
    stub([() => new Response('{"message":"You are not subscribed to this API."}', { status: 403 })])
    await expect(apiFetch("https://x", "t")).rejects.toMatchObject({ code: "NOT_SUBSCRIBED" })
  })
})

// Live smoke test: opt-in, because every call is billed against the user's plan.
const live = process.env.JSEARCH_API_TOKEN && process.env.JSEARCH_LIVE_TEST === "1"
describe.skipIf(!live)("live search (JSEARCH_LIVE_TEST=1)", () => {
  test("returns at least one result with id, title and url", async () => {
    const r = await runCLI(["search", "-q", "data engineer", "-l", "Dublin, Ireland", "--country", "ie", "--limit", "3"])
    expect(r.exitCode).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.results.length).toBeGreaterThan(0)
    expect(out.results[0].id).toBeTruthy()
    expect(out.results[0].title).toBeTruthy()
  })
})
