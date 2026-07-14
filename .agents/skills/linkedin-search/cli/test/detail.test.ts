import { describe, expect, test } from "bun:test"
import { normalizeId } from "../src/commands/detail.ts"

describe("normalizeId", () => {
  test("accepts a bare numeric id", () => {
    expect(normalizeId("4345841651")).toBe("4345841651")
  })

  test("extracts the id from a jobs/view URL", () => {
    expect(
      normalizeId(
        "https://www.linkedin.com/jobs/view/agentic-ai-engineer-full-remote-europe-at-orbis-group-4345841651",
      ),
    ).toBe("4345841651")
  })

  test("extracts the id from a jobs/view URL with a query string", () => {
    expect(
      normalizeId("https://www.linkedin.com/jobs/view/4345841651?refId=abc"),
    ).toBe("4345841651")
  })

  test("extracts the id from a job-posting URN", () => {
    expect(normalizeId("urn:li:jobPosting:4345841651")).toBe("4345841651")
  })

  test("returns null when no id can be parsed", () => {
    expect(normalizeId("not-a-job")).toBeNull()
    expect(normalizeId("")).toBeNull()
    expect(normalizeId("12345")).toBeNull() // too short to be a job id
  })
})
