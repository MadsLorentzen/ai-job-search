// Offline tests for the company registry and the concurrency pool that make
// role-first search possible. No network.
import { describe, expect, test } from "bun:test"
import { pool, loadRegistry, REGISTRY_PATH, matchesUsRemote, normalizeJob } from "../src/helpers.js"
import { toSlug } from "../src/commands/discover.js"
import { runCLI } from "./helpers.js"

describe("toSlug", () => {
  test("lowercases and strips punctuation and spaces", () => {
    expect(toSlug("Modern Treasury")).toBe("moderntreasury")
    expect(toSlug("Gusto, Inc.")).toBe("gustoinc")
    expect(toSlug("  Stripe  ")).toBe("stripe")
  })

  test("expands & to 'and' rather than dropping it", () => {
    // "Jack & Jill" -> "jackandjill", not "jackjill"
    expect(toSlug("Jack & Jill")).toBe("jackandjill")
  })

  test("drops apostrophes without leaving a gap", () => {
    expect(toSlug("Moody's")).toBe("moodys")
  })

  test("returns empty for input with no usable characters", () => {
    expect(toSlug("   ")).toBe("")
    expect(toSlug("!!!")).toBe("")
  })
})

describe("pool", () => {
  test("preserves input order in the results", async () => {
    // Deliberately resolve later items faster, so order can only be right if
    // results are written by index rather than completion.
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
    expect(peak).toBeGreaterThan(1) // proves it actually parallelized
  })

  test("handles an empty item list without hanging", async () => {
    expect(await pool([], 8, async () => 1)).toEqual([])
  })

  test("a limit larger than the item count is harmless", async () => {
    expect(await pool([1, 2], 99, async (n) => n * 2)).toEqual([2, 4])
  })
})

describe("loadRegistry", () => {
  test("loads the shipped registry and finds known boards", async () => {
    const boards = await loadRegistry("greenhouse")
    expect(boards.length).toBeGreaterThan(20)
    expect(boards).toContain("stripe")
    expect(boards).toContain("gusto")
  })

  test("reads the lever list from the same shared file", async () => {
    const sites = await loadRegistry("lever")
    expect(sites.length).toBeGreaterThan(0)
    expect(sites).toContain("plaid")
  })

  test("the registry path resolves out of cli/src to .agents/ats-registry", () => {
    // Regression: an earlier version was one level short and silently returned
    // an empty registry, making --registry look broken.
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
    // The message must mention BOTH routes, or the user can't tell what to do.
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

describe("matchesUsRemote", () => {
  const mk = (loc: string) => normalizeJob({ id: 1, title: "T", location: { name: loc } }, "b")!

  test("accepts every US remote spelling Greenhouse actually uses", () => {
    // All four observed live on 2026-08-05 across the registry. No single
    // --location substring catches all of them, which is why this exists.
    for (const l of [
      "Remote US", "Remote - US", "Remote - United States", "Remote, USA",
      "Remote - USA", "US Remote", "Remote (US)",
    ]) {
      expect(matchesUsRemote(mk(l))).toBe(true)
    }
  })

  test("rejects non-US remote — the bug that made -l Remote unusable", () => {
    for (const l of ["Remote Canada", "Remote Poland", "Remote Spain", "Remote - Canada", "Remote India", "Remote EMEA"]) {
      expect(matchesUsRemote(mk(l))).toBe(false)
    }
  })

  test("accepts a multi-region posting that includes the US", () => {
    // Genuinely open to US candidates, so it must not be dropped.
    expect(matchesUsRemote(mk("Remote US; Remote Canada"))).toBe(true)
    expect(matchesUsRemote(mk("Remote - United States, Remote - Poland"))).toBe(true)
  })

  test("rejects on-site roles regardless of country", () => {
    expect(matchesUsRemote(mk("San Francisco, CA"))).toBe(false)
    expect(matchesUsRemote(mk("New York"))).toBe(false)
  })

  test("accepts unqualified remote (no country named)", () => {
    expect(matchesUsRemote(mk("Remote"))).toBe(true)
    expect(matchesUsRemote(mk("Anywhere"))).toBe(true)
  })

  test("a job with no location is not assumed US-remote", () => {
    expect(matchesUsRemote(normalizeJob({ id: 1, title: "T" }, "b")!)).toBe(false)
  })
})
