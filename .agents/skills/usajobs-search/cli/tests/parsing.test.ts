// Offline tests over pure functions — no network.
//
// NOTE: the fixture below is built from USAJOBS' published response schema, not
// from a captured live response — verifying against live data needs an API key
// (see ../../SKILL.md). Treat these as contract tests for the parser's shape
// handling; re-check them against a real response once a key is configured.
import { describe, expect, test } from "bun:test"
import {
  normalizeJob,
  parseJobs,
  formatSalary,
  toIsoDate,
  clampDatePosted,
  readCredentials,
  buildDescription,
  htmlToText,
  type RawItem,
} from "../src/helpers.js"
import { buildUrl } from "../src/commands/search.js"
import { extractId, selectMatch, buildDetail, buildDetailUrl } from "../src/commands/detail.js"

const FIXTURE: RawItem = {
  MatchedObjectId: "828810900",
  MatchedObjectDescriptor: {
    PositionID: "ST-12345678-26-XY",
    PositionTitle: "Data Scientist",
    // Live shape: USAJOBS emits the explicit default port.
    PositionURI: "https://www.usajobs.gov:443/job/828810900",
    ApplyURI: ["https://www.usajobs.gov:443/job/828810900/apply"],
    PositionLocationDisplay: "Anywhere in the U.S. (remote job)",
    OrganizationName: "Internal Revenue Service",
    DepartmentName: "Department of the Treasury",
    JobGrade: [{ Code: "GS" }],
    // Live shape: Name is EMPTY, only Code is populated.
    PositionSchedule: [{ Name: "", Code: "1" }],
    PositionRemuneration: [
      {
        MinimumRange: "99200",
        MaximumRange: "153354",
        RateIntervalCode: "PA",
        Description: "Per Year",
      },
    ],
    PublicationStartDate: "2026-08-01",
    ApplicationCloseDate: "2026-08-31",
    QualificationSummary: "You must have <b>one year</b> of specialized experience.",
    UserArea: {
      Details: {
        JobSummary: "<p>Analyze data &amp; build models.</p>",
        MajorDuties: ["Build pipelines", "Brief leadership"],
        Requirements: "<p>US citizenship required.</p>",
      },
    },
  },
}

describe("readCredentials", () => {
  test("returns both values when present", () => {
    expect(readCredentials({ USAJOBS_API_KEY: "k", USAJOBS_EMAIL: "e@x.com" })).toEqual({
      apiKey: "k",
      email: "e@x.com",
    })
  })

  test("returns null when either is missing or blank", () => {
    expect(readCredentials({ USAJOBS_API_KEY: "k" })).toBeNull()
    expect(readCredentials({ USAJOBS_EMAIL: "e@x.com" })).toBeNull()
    expect(readCredentials({ USAJOBS_API_KEY: "  ", USAJOBS_EMAIL: "e@x.com" })).toBeNull()
    expect(readCredentials({})).toBeNull()
  })
})

describe("normalizeJob", () => {
  test("maps the documented field paths onto the contract shape", () => {
    const c = normalizeJob(FIXTURE)!
    expect(c.id).toBe("828810900") // MatchedObjectId is the control number
    expect(c.title).toBe("Data Scientist")
    expect(c.company).toBe("Internal Revenue Service")
    expect(c.department).toBe("Department of the Treasury")
    expect(c.positionId).toBe("ST-12345678-26-XY")
    expect(c.grade).toBe("GS")
    expect(c.source).toBe("USAJOBS")
  })

  // The three regressions below were all found against LIVE data — the schema
  // alone did not reveal them.
  test("resolves the schedule from Code when Name is empty (as it always is live)", () => {
    expect(normalizeJob(FIXTURE)!.schedule).toBe("Full-time")
  })

  test("still honours Name when USAJOBS does populate it", () => {
    const c = normalizeJob({
      ...FIXTURE,
      MatchedObjectDescriptor: {
        ...FIXTURE.MatchedObjectDescriptor,
        PositionSchedule: [{ Name: "Part-time", Code: "1" }],
      },
    })!
    expect(c.schedule).toBe("Part-time")
  })

  test("an unknown schedule code degrades legibly instead of vanishing", () => {
    const c = normalizeJob({
      ...FIXTURE,
      MatchedObjectDescriptor: {
        ...FIXTURE.MatchedObjectDescriptor,
        PositionSchedule: [{ Name: "", Code: "99" }],
      },
    })!
    expect(c.schedule).toBe("Schedule 99")
  })

  test("strips the :443 default port USAJOBS puts in PositionURI", () => {
    // /scrape dedupes on URL, so :443 and bare forms must not diverge.
    expect(normalizeJob(FIXTURE)!.url).toBe("https://www.usajobs.gov/job/828810900")
  })

  test("detects remote from the location display", () => {
    expect(normalizeJob(FIXTURE)!.remote).toBe(true)
    const onsite = normalizeJob({
      ...FIXTURE,
      MatchedObjectDescriptor: {
        ...FIXTURE.MatchedObjectDescriptor,
        PositionLocationDisplay: "Austin, Texas",
      },
    })!
    expect(onsite.remote).toBe(false)
  })

  test("contract fields are null, never omitted", () => {
    const c = normalizeJob({
      MatchedObjectId: "1",
      MatchedObjectDescriptor: { PositionTitle: "Bare" },
    })!
    expect(c.company).toBeNull()
    expect(c.location).toBeNull()
    expect(c.salary).toBeNull()
    expect(c.grade).toBeNull()
    expect(c.schedule).toBeNull()
    expect(c.closeDate).toBeNull()
  })

  test("rejects records with no descriptor, id or title", () => {
    // No descriptor at all.
    expect(normalizeJob({ MatchedObjectId: "1" })).toBeNull()
    // Descriptor present but carrying neither identifier — nothing to key on.
    expect(normalizeJob({ MatchedObjectDescriptor: { PositionTitle: "T" } })).toBeNull()
    // Identifier present but no title.
    expect(normalizeJob({ MatchedObjectId: "1", MatchedObjectDescriptor: {} })).toBeNull()
    expect(normalizeJob(null as unknown as RawItem)).toBeNull()
  })

  test("falls back to PositionID when MatchedObjectId is absent", () => {
    const c = normalizeJob({
      MatchedObjectDescriptor: { PositionID: "ST-1", PositionTitle: "T" },
    })!
    expect(c.id).toBe("ST-1")
  })
})

describe("parseJobs", () => {
  test("one malformed item cannot break the rest of the page", () => {
    const cards = parseJobs({
      SearchResult: {
        SearchResultItems: [
          FIXTURE,
          { MatchedObjectId: "x" },
          { MatchedObjectId: "2", MatchedObjectDescriptor: { PositionTitle: "Ok" } },
        ],
      },
    })
    expect(cards).toHaveLength(2)
    expect(cards[1]!.id).toBe("2")
  })

  test("tolerates a missing SearchResult envelope", () => {
    expect(parseJobs(null)).toEqual([])
    expect(parseJobs({})).toEqual([])
    expect(parseJobs({ SearchResult: {} })).toEqual([])
  })
})

describe("formatSalary", () => {
  test("prefers Description over the terse RateIntervalCode", () => {
    // Live data returns RateIntervalCode "PA" plus Description "Per Year";
    // rendering the code produced "$99,200 - $153,354 PA".
    expect(formatSalary(FIXTURE.MatchedObjectDescriptor!.PositionRemuneration)).toBe(
      "$99,200 - $153,354 Per Year",
    )
  })

  test("falls back to the code when Description is absent", () => {
    expect(formatSalary([{ MinimumRange: "50000", MaximumRange: "60000", RateIntervalCode: "PH" }])).toBe(
      "$50,000 - $60,000 PH",
    )
  })

  test("handles a single-sided band", () => {
    expect(formatSalary([{ MinimumRange: "50000", Description: "Per Year" }])).toBe(
      "$50,000 Per Year",
    )
  })

  test("returns null when there is no salary data", () => {
    expect(formatSalary(undefined)).toBeNull()
    expect(formatSalary([])).toBeNull()
    expect(formatSalary([{ RateIntervalCode: "Per Year" }])).toBeNull()
  })
})

describe("toIsoDate", () => {
  test("parses a zone-less USAJOBS date as UTC", () => {
    expect(toIsoDate("2026-08-01")).toBe("2026-08-01T00:00:00.000Z")
  })

  test("rejects absent or unparseable values", () => {
    expect(toIsoDate(undefined)).toBeNull()
    expect(toIsoDate("nope")).toBeNull()
  })
})

describe("clampDatePosted", () => {
  test("clamps to the API maximum of 60 days rather than erroring", () => {
    expect(clampDatePosted(90)).toBe(60)
    expect(clampDatePosted(14)).toBe(14)
  })

  test("a sentinel or zero disables the parameter", () => {
    expect(clampDatePosted(9999)).toBeNull()
    expect(clampDatePosted(0)).toBeNull()
  })
})

describe("buildUrl", () => {
  const base = {
    jobage: 9999,
    page: 1,
    format: "json" as const,
  }

  test("maps flags onto the documented USAJOBS parameter names", () => {
    const url = buildUrl({ ...base, query: "data scientist", location: "Austin, Texas" })
    expect(url).toContain("Keyword=data+scientist")
    expect(url).toContain("LocationName=Austin%2C+Texas")
    expect(url).toContain("WhoMayApply=Public")
  })

  test("--remote and --onsite map to RemoteIndicator True/False", () => {
    expect(buildUrl({ ...base, remote: true })).toContain("RemoteIndicator=True")
    expect(buildUrl({ ...base, remote: false })).toContain("RemoteIndicator=False")
  })

  test("RemoteIndicator is omitted entirely when unset (API default includes remote)", () => {
    expect(buildUrl(base)).not.toContain("RemoteIndicator")
  })

  test("DatePosted is clamped into the API's 0-60 range", () => {
    expect(buildUrl({ ...base, jobage: 400 })).toContain("DatePosted=60")
    expect(buildUrl(base)).not.toContain("DatePosted")
  })

  test("ResultsPerPage is capped at the API maximum of 500", () => {
    expect(buildUrl({ ...base, limit: 9000 })).toContain("ResultsPerPage=500")
  })
})

describe("detail", () => {
  test("extracts an id from a control number, announcement number or URL", () => {
    expect(extractId("828810900")).toBe("828810900")
    expect(extractId("ST-12345678-26-XY")).toBe("ST-12345678-26-XY")
    expect(extractId("https://www.usajobs.gov/job/828810900")).toBe("828810900")
    expect(extractId("")).toBeNull()
  })

  test("the detail query asks for fields=all so the description block is present", () => {
    const url = buildDetailUrl("828810900")
    expect(url).toContain("fields=all")
    expect(url).toContain("Keyword=828810900")
  })

  test("selectMatch requires an exact id match, not a fuzzy keyword hit", () => {
    const response = {
      SearchResult: {
        SearchResultItems: [
          { MatchedObjectId: "999", MatchedObjectDescriptor: { PositionTitle: "Other" } },
          FIXTURE,
        ],
      },
    }
    expect(selectMatch(response, "828810900")).toBe(FIXTURE)
    expect(selectMatch(response, "ST-12345678-26-XY")).toBe(FIXTURE)
    expect(selectMatch(response, "not-present")).toBeNull()
    expect(selectMatch(null, "828810900")).toBeNull()
  })

  test("buildDetail assembles summary, duties and requirements", () => {
    const d = buildDetail(FIXTURE)!
    expect(d.description).toContain("Analyze data & build models.")
    expect(d.description).toContain("- Build pipelines")
    expect(d.description).toContain("US citizenship required.")
    expect(d.qualifications).toContain("one year")
    expect(d.applyUrl).toBe("https://www.usajobs.gov/job/828810900/apply")
  })

  test("buildDescription returns null when the detail block is absent", () => {
    expect(buildDescription({ PositionTitle: "T" })).toBeNull()
    expect(buildDescription(undefined)).toBeNull()
  })
})

describe("htmlToText", () => {
  test("decodes entities and strips tags", () => {
    expect(htmlToText("<p>A &amp; B</p>")).toBe("A & B")
  })
})
