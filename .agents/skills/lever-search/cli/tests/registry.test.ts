// Offline tests for the shared company registry and concurrency pool. No network.
import { describe, expect, test } from "bun:test"
import { pool, loadRegistry, REGISTRY_PATH } from "../src/helpers.js"
import { toSlug } from "../src/commands/discover.js"
import { runCLI } from "./helpers.js"

describe("toSlug", () => {
  test("lowercases and strips punctuation and spaces", () => {
    expect(toSlug("Modern Treasury")).toBe("moderntreasury")
    expect(toSlug("  Plaid  ")).toBe("plaid")
  })

  test("expands & to 'and'", () => {
    expect(toSlug("Rock & Roll")).toBe("rockandroll")
  })

  test("returns empty for input with no usable characters", () => {
    expect(toSlug("   ")).toBe("")
  })
})

describe("pool", () => {
  test("preserves input order regardless of completion order", async () => {
    const out = await pool([5, 3, 1], 3, async (n) => {
      await new Promise((r) => setTimeout(r, n * 10))
      return n
    })
    expect(out).toEqual([5, 3, 1])
  })

  test("never exceeds the concurrency limit", async () => {
    let inFlight = 0
    let peak = 0
    await pool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  test("handles an empty item list without hanging", async () => {
    expect(await pool([], 8, async () => 1)).toEqual([])
  })
})

describe("loadRegistry", () => {
  test("loads the lever site list from the shared registry", async () => {
    const sites = await loadRegistry("lever")
    expect(sites.length).toBeGreaterThan(0)
    expect(sites).toContain("plaid")
  })

  test("reads greenhouse boards from the same file", async () => {
    const boards = await loadRegistry("greenhouse")
    expect(boards).toContain("stripe")
  })

  test("the registry path resolves out of cli/src to .agents/ats-registry", () => {
    expect(REGISTRY_PATH.replace(/\\/g, "/")).toContain("ats-registry/companies.json")
    expect(REGISTRY_PATH.replace(/\\/g, "/")).not.toContain("skills/ats-registry")
  })
})

describe("CLI registry wiring", () => {
  test("search with neither --registry nor --company is a clear error", async () => {
    const r = await runCLI(["search", "-q", "engineer"])
    expect(r.exitCode).toBe(1)
    const err = JSON.parse(r.stderr)
    expect(err.code).toBe("NO_COMPANY")
    expect(err.error).toContain("--registry")
    expect(err.error).toContain("--company")
  })

  test("discover with no candidates errors before probing", async () => {
    const r = await runCLI(["discover"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NO_CANDIDATES")
  })

  test("help documents role-first search", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("--registry")
    expect(r.stdout).toContain("role-first")
  })
})
