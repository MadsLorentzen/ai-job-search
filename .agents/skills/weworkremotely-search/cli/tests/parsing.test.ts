// Offline tests over pure functions — no network.
import { describe, expect, test } from "bun:test"
import {
  parseFeed,
  descriptionFor,
  splitTitle,
  idFromLink,
  tagText,
  toIsoDate,
  matchesQuery,
  matchesRegion,
  withinJobAge,
  resolveCategory,
  feedUrl,
  decodeHtmlEntities,
  htmlToText,
  ALL_FEED,
} from "../src/helpers.js"
import { extractId, feedsToTry } from "../src/commands/detail.js"

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>We Work Remotely</title>
  <item>
    <title>Stripe: Backend Engineer, AI Security</title>
    <region>Anywhere in the World</region>
    <country>United States of America</country>
    <skills>Go, Rust</skills>
    <category>Back-End Programming</category>
    <type>Full-Time</type>
    <link>https://weworkremotely.com/remote-jobs/stripe-backend-engineer-ai-security</link>
    <pubDate>Tue, 22 Jul 2026 07:01:06 +0000</pubDate>
    <description>&lt;p&gt;Build &amp;amp; secure systems.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;</description>
  </item>
  <item>
    <title>Acme Corp: Engineer: Platform</title>
    <region>USA Only</region>
    <link>https://weworkremotely.com/remote-jobs/acme-corp-engineer-platform</link>
    <pubDate>Mon, 21 Jul 2026 07:01:06 +0000</pubDate>
    <description>Short.</description>
  </item>
  <item>
    <title>Malformed with no link</title>
  </item>
</channel></rss>`

describe("splitTitle", () => {
  test("splits 'Company: Title' on the first colon", () => {
    expect(splitTitle("Stripe: Backend Engineer")).toEqual({
      company: "Stripe",
      title: "Backend Engineer",
    })
  })

  test("keeps later colons in the job title", () => {
    expect(splitTitle("Acme Corp: Engineer: Platform")).toEqual({
      company: "Acme Corp",
      title: "Engineer: Platform",
    })
  })

  test("handles a company name containing a comma", () => {
    expect(splitTitle("Gusto, Inc.: Business Money Engineering")).toEqual({
      company: "Gusto, Inc.",
      title: "Business Money Engineering",
    })
  })

  test("falls back to the whole string when there is no colon", () => {
    expect(splitTitle("Just A Title")).toEqual({ company: null, title: "Just A Title" })
  })

  test("does not produce an empty company or title", () => {
    expect(splitTitle(": Orphaned")).toEqual({ company: null, title: ": Orphaned" })
    expect(splitTitle("Trailing:")).toEqual({ company: null, title: "Trailing:" })
  })
})

describe("idFromLink", () => {
  test("takes the slug from the posting URL", () => {
    expect(idFromLink("https://weworkremotely.com/remote-jobs/stripe-backend-engineer")).toBe(
      "stripe-backend-engineer",
    )
  })

  test("returns null for an unrelated URL", () => {
    expect(idFromLink("https://example.com/jobs/1")).toBeNull()
  })
})

describe("parseFeed", () => {
  const cards = parseFeed(FEED)

  test("parses well-formed items and skips the one with no link", () => {
    expect(cards).toHaveLength(2)
    expect(cards[0]!.id).toBe("stripe-backend-engineer-ai-security")
  })

  test("maps the RSS tags onto the contract shape", () => {
    const c = cards[0]!
    expect(c.title).toBe("Backend Engineer, AI Security")
    expect(c.company).toBe("Stripe")
    expect(c.date).toBe("2026-07-22T07:01:06.000Z")
    expect(c.category).toBe("Back-End Programming")
    expect(c.jobType).toBe("Full-Time")
    expect(c.skills).toBe("Go, Rust")
    expect(c.region).toBe("Anywhere in the World")
    expect(c.source).toBe("We Work Remotely")
  })

  test("location prefers the specific country over the broad region", () => {
    expect(cards[0]!.location).toBe("United States of America")
    expect(cards[1]!.location).toBe("USA Only") // no <country> on this item
  })

  test("optional tags are null, never omitted", () => {
    const c = cards[1]!
    expect(c.country).toBeNull()
    expect(c.skills).toBeNull()
    expect(c.category).toBeNull()
    expect(c.jobType).toBeNull()
  })

  test("an empty feed yields no cards rather than throwing", () => {
    expect(parseFeed("")).toEqual([])
    expect(parseFeed("<rss><channel></channel></rss>")).toEqual([])
  })
})

describe("tagText / entity decoding", () => {
  test("unwraps CDATA sections", () => {
    expect(tagText("<title><![CDATA[Hello & bye]]></title>", "title")).toBe("Hello & bye")
  })

  test("decodes &amp; last so double-escaped markup survives one pass", () => {
    expect(decodeHtmlEntities("&amp;lt;p&amp;gt;")).toBe("&lt;p&gt;")
  })

  test("decodes decimal and hex numeric entities", () => {
    expect(decodeHtmlEntities("caf&#233; caf&#xE9;")).toBe("café café")
  })
})

describe("descriptionFor", () => {
  test("returns readable text for the matching item", () => {
    const d = descriptionFor(FEED, "stripe-backend-engineer-ai-security")!
    expect(d).toContain("Build & secure systems.")
    expect(d).toContain("- Go")
    expect(d).not.toContain("<p>")
  })

  test("returns null when the id is not in the feed", () => {
    expect(descriptionFor(FEED, "nope")).toBeNull()
  })
})

describe("htmlToText", () => {
  test("converts list items to dashes", () => {
    expect(htmlToText("<li>One</li><li>Two</li>")).toBe("- One\n- Two")
  })
})

describe("toIsoDate", () => {
  test("parses an RFC-822 pubDate", () => {
    expect(toIsoDate("Tue, 22 Jul 2026 07:01:06 +0000")).toBe("2026-07-22T07:01:06.000Z")
  })

  test("rejects absent or unparseable values", () => {
    expect(toIsoDate(null)).toBeNull()
    expect(toIsoDate("not a date")).toBeNull()
  })
})

describe("matchesQuery / matchesRegion", () => {
  const cards = parseFeed(FEED)

  test("query matches title, company and skills", () => {
    expect(matchesQuery(cards[0]!, "backend")).toBe(true)
    expect(matchesQuery(cards[0]!, "stripe")).toBe(true)
    expect(matchesQuery(cards[0]!, "rust")).toBe(true) // via skills
    expect(matchesQuery(cards[0]!, "backend plumbing")).toBe(false)
  })

  test("'USA' matches both US-only and worldwide listings", () => {
    expect(matchesRegion(cards[0]!, "USA")).toBe(true) // Anywhere in the World
    expect(matchesRegion(cards[1]!, "USA")).toBe(true) // USA Only
  })

  test("an absent region filter passes everything", () => {
    expect(matchesRegion(cards[0]!, undefined)).toBe(true)
  })
})

describe("withinJobAge", () => {
  const now = Date.parse("2026-07-25T00:00:00Z")
  const c = parseFeed(FEED)[0]! // 2026-07-22

  test("keeps recent postings and drops older ones", () => {
    expect(withinJobAge(c, 7, now)).toBe(true)
    expect(withinJobAge(c, 1, now)).toBe(false)
  })
})

describe("category resolution", () => {
  test("accepts a full slug", () => {
    expect(resolveCategory("remote-programming-jobs")).toBe("remote-programming-jobs")
  })

  test("accepts a short form", () => {
    expect(resolveCategory("programming")).toBe("remote-programming-jobs")
    expect(resolveCategory("design")).toBe("remote-design-jobs")
  })

  test("rejects an unknown category rather than guessing", () => {
    expect(resolveCategory("underwater-basket-weaving")).toBeNull()
  })

  test("feedUrl falls back to the combined feed with no category", () => {
    expect(feedUrl(undefined)).toBe(ALL_FEED)
    expect(feedUrl("remote-design-jobs")).toContain("/categories/remote-design-jobs.rss")
  })
})

describe("detail helpers", () => {
  test("extracts an id from a URL or a bare slug", () => {
    expect(extractId("https://weworkremotely.com/remote-jobs/acme-engineer")).toBe("acme-engineer")
    expect(extractId("acme-engineer")).toBe("acme-engineer")
    expect(extractId("ab")).toBeNull()
  })

  test("with no category, detail sweeps the combined feed first then each category", () => {
    const feeds = feedsToTry(undefined)
    expect(feeds[0]).toBe(ALL_FEED)
    expect(feeds.length).toBeGreaterThan(1)
  })

  test("with a category, detail checks only that feed", () => {
    expect(feedsToTry("remote-design-jobs")).toHaveLength(1)
  })
})
