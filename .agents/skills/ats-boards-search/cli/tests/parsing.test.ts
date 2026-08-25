import { describe, expect, test } from "bun:test"
import {
  parseAshbyJobs,
  parseBoard,
  parseBoardsFile,
  parseGreenhouseJobs,
  parseLeverJobs,
  stripHtml,
  withinJobAge,
} from "../src/helpers.ts"

describe("parseBoard", () => {
  test("accepts greenhouse:stripe", () => {
    expect(parseBoard("greenhouse:stripe")).toEqual({
      kind: "greenhouse",
      token: "stripe",
      raw: "greenhouse:stripe",
    })
  })

  test("rejects unknown kinds and missing tokens", () => {
    expect(() => parseBoard("naukri:foo")).toThrow(/unknown board kind/)
    expect(() => parseBoard("greenhouse")).toThrow(/kind:token/)
  })
})

describe("parseBoardsFile", () => {
  test("reads a boards array", () => {
    const refs = parseBoardsFile(JSON.stringify({ boards: ["lever:netflix", "ashby:openai"] }))
    expect(refs.map((b) => b.raw)).toEqual(["lever:netflix", "ashby:openai"])
  })
})

describe("Greenhouse/Lever/Ashby parsers", () => {
  test("greenhouse jobs keep title, url, ascii date", () => {
    const jobs = parseGreenhouseJobs(
      {
        jobs: [
          {
            id: 99,
            title: "Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/99",
            updated_at: "2026-01-15T00:00:00Z",
            location: { name: "Remote" },
            content: "<p>Python &amp; Go</p>",
          },
        ],
      },
      "Acme",
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0].title).toBe("Engineer")
    expect(jobs[0].company).toBe("Acme")
    expect(jobs[0].date).toBe("2026-01-15")
    expect(jobs[0].description).toContain("Python & Go")
  })

  test("lever jobs use hostedUrl and createdAt millis", () => {
    const jobs = parseLeverJobs(
      [
        {
          id: "abc",
          text: "Designer",
          hostedUrl: "https://jobs.lever.co/acme/abc",
          createdAt: Date.parse("2026-02-01T00:00:00Z"),
          categories: { location: "Berlin" },
          descriptionPlain: "Figma",
        },
      ],
      "Acme",
    )
    expect(jobs[0].id).toBe("lever:abc")
    expect(jobs[0].location).toBe("Berlin")
    expect(jobs[0].date).toBe("2026-02-01")
  })

  test("ashby jobs use jobUrl", () => {
    const jobs = parseAshbyJobs(
      {
        jobs: [
          {
            id: "j1",
            title: "PM",
            jobUrl: "https://jobs.ashbyhq.com/acme/j1",
            location: "London",
            publishedAt: "2026-03-01",
          },
        ],
      },
      "Acme",
    )
    expect(jobs[0].url).toContain("ashbyhq")
    expect(jobs[0].title).toBe("PM")
  })

  test("drops incomplete records", () => {
    expect(parseGreenhouseJobs({ jobs: [{ id: 1 }] }, "X")).toEqual([])
  })
})

describe("stripHtml", () => {
  test("decodes entities and drops tags", () => {
    expect(stripHtml("<p>A &amp; B<br/>C</p>")).toBe("A & B\nC")
  })
})

describe("withinJobAge", () => {
  test("keeps undated jobs", () => {
    expect(withinJobAge({ id: "1", title: "t", company: null, location: null, date: null, url: "u" }, 7)).toBe(true)
  })
})
