import { describe, expect, test } from "bun:test"
import { normalizeId, buildOfferUrl, parseOfferDetail, cleanHtml } from "../src/helpers.js"

describe("normalizeId", () => {
  test("accepts a bare 24-hex id", () => {
    expect(normalizeId("6aaf5383865119c687d03d66")).toBe("6aaf5383865119c687d03d66")
  })

  test("extracts the id from a full offer URL", () => {
    expect(
      normalizeId("https://jobgether.com/offer/6aaf5383865119c687d03d66-senior-product-manager"),
    ).toBe("6aaf5383865119c687d03d66")
  })

  test("rejects garbage input", () => {
    expect(normalizeId("not-an-id")).toBeNull()
    expect(normalizeId("")).toBeNull()
  })
})

describe("buildOfferUrl", () => {
  test("builds a resolvable offer URL from a bare id", () => {
    expect(buildOfferUrl("6aaf5383865119c687d03d66")).toBe(
      "https://jobgether.com/offer/6aaf5383865119c687d03d66-job",
    )
  })
})

describe("cleanHtml", () => {
  test("strips tags and preserves paragraph breaks", () => {
    expect(cleanHtml("<h3>About</h3><p>Line one</p><p>Line two</p>")).toBe("About\nLine one\nLine two")
  })

  test("returns null for empty input", () => {
    expect(cleanHtml(null)).toBeNull()
    expect(cleanHtml("")).toBeNull()
  })
})

describe("parseOfferDetail", () => {
  const html = `
    <html><body>
    <script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Senior Product Manager",
        "description": "<p>About the role</p><p>Do the thing</p>",
        "hiringOrganization": {"name": "Clera Inc."},
        "datePosted": "2026-09-20T03:31:15.864Z",
        "employmentType": ["FULL_TIME"],
        "validThrough": "2026-11-20T03:31:15.864Z",
        "applicantLocationRequirements": [{"@type": "Country", "name": "AT"}]
      }
    </script>
    <a data-apply-url="https://jobs.ashbyhq.com/Clera/apply">Apply</a>
    </body></html>
  `

  test("reads title, company, description, employmentType, deadline and apply link from JSON-LD", () => {
    const job = parseOfferDetail(html, "6aaf5383865119c687d03d66", "https://jobgether.com/offer/6aaf5383865119c687d03d66-job")
    expect(job.title).toBe("Senior Product Manager")
    expect(job.company).toBe("Clera Inc.")
    expect(job.description).toBe("About the role\nDo the thing")
    expect(job.employmentType).toBe("FULL_TIME")
    expect(job.deadline).toBe("2026-11-20T03:31:15.864Z")
    expect(job.applyUrl).toBe("https://jobs.ashbyhq.com/Clera/apply")
    expect(job.location).toBe("AT")
  })

  test("falls back to safe defaults when no JobPosting block is present", () => {
    const job = parseOfferDetail("<html><body>gone</body></html>", "deadbeefdeadbeefdeadbeef", "https://jobgether.com/offer/deadbeefdeadbeefdeadbeef-job")
    expect(job.title).toBe("(untitled)")
    expect(job.company).toBeNull()
    expect(job.description).toBeNull()
    expect(job.applyUrl).toBeNull()
  })
})
