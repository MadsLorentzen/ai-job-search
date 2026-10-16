import { describe, expect, test } from "bun:test"
import { cursorOf, dataOf, filterByAge, jobageToDatePosted, readToken, toDetail, toResult } from "../src/helpers"
import { buildUrl } from "../src/commands/search"

// Offline: a JSearch job object shaped like the API's documented response.
// No request is made here, so these tests never spend the user's quota.
const RAW = {
  job_id: "abc123==",
  job_title: "Data Engineer",
  employer_name: "Example Ltd",
  employer_website: "https://example.ie",
  job_publisher: "Indeed",
  job_employment_type: "FULLTIME",
  job_apply_link: "https://ie.indeed.com/viewjob?jk=1",
  job_is_remote: false,
  job_posted_at_timestamp: 1792000000,
  job_city: "Dublin",
  job_country: "IE",
  apply_options: [
    { publisher: "Indeed", apply_link: "https://ie.indeed.com/viewjob?jk=1", is_direct: false },
    { publisher: "Example Ltd", apply_link: "https://example.ie/careers/1", is_direct: true },
    { publisher: "Broken", apply_link: null },
  ],
  job_description: "Build pipelines.",
  job_highlights: { Qualifications: ["SQL", "Python"], Responsibilities: ["ETL"] },
}

describe("toResult", () => {
  test("maps the contract fields and keeps every usable apply option", () => {
    const r = toResult(RAW)!
    expect(r.id).toBe("abc123==")
    expect(r.title).toBe("Data Engineer")
    expect(r.company).toBe("Example Ltd")
    expect(r.location).toBe("Dublin, IE")
    expect(r.date).toBe(new Date(1792000000 * 1000).toISOString().slice(0, 10))
    expect(r.publisher).toBe("Indeed")
    expect(r.applyOptions).toHaveLength(2)
    expect(r.applyOptions[1]).toEqual({ publisher: "Example Ltd", url: "https://example.ie/careers/1", isDirect: true })
  })

  test("missing values are null, never omitted", () => {
    const r = toResult({ job_id: "x", job_title: "QA" })!
    for (const k of ["company", "location", "date", "url"]) {
      expect(k in r).toBe(true)
      expect((r as unknown as Record<string, unknown>)[k]).toBeNull()
    }
  })

  test("a job without id or title is dropped", () => {
    expect(toResult({ job_title: "x" })).toBeNull()
    expect(toResult({ job_id: "x" })).toBeNull()
  })

  test("falls back to the UTC datetime when there is no timestamp", () => {
    expect(toResult({ job_id: "x", job_title: "y", job_posted_at_datetime_utc: "2026-10-14T09:00:00.000Z" })!.date).toBe("2026-10-14")
  })
})

describe("toDetail", () => {
  test("adds description and highlights", () => {
    const d = toDetail(RAW)!
    expect(d.description).toBe("Build pipelines.")
    expect(d.qualifications).toEqual(["SQL", "Python"])
    expect(d.responsibilities).toEqual(["ETL"])
  })
})

describe("date window", () => {
  test("days map to the smallest JSearch bucket that contains them", () => {
    expect(jobageToDatePosted(undefined)).toBe("all")
    expect(jobageToDatePosted(1)).toBe("today")
    expect(jobageToDatePosted(2)).toBe("3days")
    expect(jobageToDatePosted(7)).toBe("week")
    expect(jobageToDatePosted(14)).toBe("month")
    expect(jobageToDatePosted(60)).toBe("all")
  })

  test("filterByAge trims to the exact window and keeps undated results", () => {
    const now = 2_000_000_000
    const rows = [
      { ...toResult(RAW)!, postedAt: now - 2 * 86400 },
      { ...toResult(RAW)!, postedAt: now - 10 * 86400 },
      { ...toResult(RAW)!, postedAt: null },
    ]
    expect(filterByAge(rows, 7, now).map((r) => r.postedAt)).toEqual([now - 2 * 86400, null])
  })
})

describe("request building", () => {
  test("location joins the query and the window becomes date_posted", () => {
    const url = new URL(buildUrl({ query: "data engineer", location: "Dublin, Ireland", country: "IE", jobage: 7, cursor: "abc", format: "json" }))
    expect(url.searchParams.get("query")).toBe("data engineer in Dublin, Ireland")
    expect(url.searchParams.get("date_posted")).toBe("week")
    expect(url.searchParams.get("country")).toBe("ie")
    expect(url.pathname).toBe("/search-v2")
    expect(new URL(buildUrl({ query: "qa", excludePublishers: "LinkedIn", format: "json" })).searchParams.get("exclude_job_publishers")).toBe("LinkedIn")
    expect(url.searchParams.get("cursor")).toBe("abc")
    expect(url.searchParams.get("num_pages")).toBe("1")
  })

  test("dataOf tolerates empty and malformed bodies", () => {
    expect(dataOf(null)).toEqual([])
    expect(dataOf({ status: "OK" })).toEqual([])
    expect(dataOf({ data: [RAW] })).toHaveLength(1)
    expect(dataOf({ data: { jobs: [RAW, RAW], cursor: "n" } })).toHaveLength(2)
    expect(cursorOf({ data: { jobs: [], cursor: "n" } })).toBe("n")
    expect(cursorOf({ data: [RAW] })).toBeNull()
  })
})

describe("credentials", () => {
  test("a missing token is a MISSING_CREDENTIALS error naming the variable", () => {
    try {
      readToken({})
      throw new Error("expected a throw")
    } catch (e) {
      expect((e as { code: string }).code).toBe("MISSING_CREDENTIALS")
      expect((e as Error).message).toContain("JSEARCH_API_TOKEN")
    }
  })
})
