import { describe, expect, test } from "bun:test"
import { parseJobPostingJsonLd } from "../src/helpers"

const script = (value: string) => `<script type="application/ld+json">${value}</script>`

describe("parseJobPostingJsonLd", () => {
  test("finds a JobPosting inside an @graph", () => {
    const html = script(
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebPage", name: "Jobs" },
          { "@type": "JobPosting", title: "Data Engineer" },
        ],
      }),
    )

    expect(parseJobPostingJsonLd(html)).toEqual({
      "@type": "JobPosting",
      title: "Data Engineer",
    })
  })

  test("preserves top-level object and array support", () => {
    expect(parseJobPostingJsonLd(script('{"@type":"JobPosting","title":"One"}'))?.title).toBe("One")
    expect(
      parseJobPostingJsonLd(script('[{"@type":"WebPage"},{"@type":"JobPosting","title":"Two"}]'))?.title,
    ).toBe("Two")
  })

  test("skips malformed scripts and checks later JSON-LD", () => {
    const html = `${script("{not-json")}${script('{"@type":"JobPosting","title":"Valid"}')}`

    expect(parseJobPostingJsonLd(html)?.title).toBe("Valid")
  })

  test("returns null when no JobPosting exists", () => {
    expect(parseJobPostingJsonLd(script('{"@graph":[{"@type":"WebPage"}]}'))).toBeNull()
  })
})
