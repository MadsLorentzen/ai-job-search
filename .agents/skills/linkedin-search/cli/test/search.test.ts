import { describe, expect, test } from "bun:test"
import { buildUrl, type SearchOpts } from "../src/commands/search.ts"

function params(opts: Partial<SearchOpts>): URLSearchParams {
  const full: SearchOpts = {
    location: "Italy",
    jobage: 9999,
    page: 1,
    format: "json",
    ...opts,
  }
  return new URL(buildUrl(full)).searchParams
}

describe("buildUrl", () => {
  test("composes keywords / location / f_TPR / f_WT / start", () => {
    const p = params({
      query: "agentic ai engineer",
      location: "Milan, Italy",
      jobage: 14,
      remote: "remote",
      page: 1,
    })
    expect(p.get("keywords")).toBe("agentic ai engineer")
    expect(p.get("location")).toBe("Milan, Italy")
    expect(p.get("f_TPR")).toBe("r1209600")
    expect(p.get("f_WT")).toBe("2")
    expect(p.get("start")).toBe("0")
  })

  test("start is (page - 1) * 10", () => {
    expect(params({ page: 1 }).get("start")).toBe("0")
    expect(params({ page: 2 }).get("start")).toBe("10")
    expect(params({ page: 5 }).get("start")).toBe("40")
  })

  test("omits f_TPR when jobage is the all-time sentinel", () => {
    expect(params({ jobage: 9999 }).has("f_TPR")).toBe(false)
    expect(params({ jobage: 0 }).has("f_TPR")).toBe(false)
  })

  test("omits f_WT when the workplace mode is unknown or unset", () => {
    expect(params({ remote: "anywhere" }).has("f_WT")).toBe(false)
    expect(params({ remote: undefined }).has("f_WT")).toBe(false)
    expect(params({ remote: "hybrid" }).get("f_WT")).toBe("3")
  })

  test("omits keywords when no query is given", () => {
    expect(params({ query: undefined }).has("keywords")).toBe(false)
  })

  test("targets the public seeMoreJobPostings search endpoint", () => {
    const url = buildUrl({
      location: "Italy",
      jobage: 9999,
      page: 1,
      format: "json",
    })
    expect(url).toContain(
      "linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search",
    )
  })
})
