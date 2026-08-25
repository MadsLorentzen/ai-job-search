import { describe, expect, test } from "bun:test"
import { parseFeed, parseFeedsFile } from "../src/helpers.ts"

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Jobs</title>
<item>
  <title>Platform Engineer</title>
  <link>https://example.com/jobs/1</link>
  <pubDate>Mon, 03 Aug 2026 12:00:00 GMT</pubDate>
  <description>&lt;p&gt;Kubernetes and Go&lt;/p&gt;</description>
</item>
<item>
  <title></title>
  <link>https://example.com/jobs/bad</link>
</item>
</channel></rss>`

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Data Analyst</title>
    <link href="https://example.com/jobs/2"/>
    <updated>2026-08-01T00:00:00Z</updated>
    <summary>SQL</summary>
  </entry>
</feed>`

describe("parseFeed", () => {
  test("parses RSS items and skips empty titles", () => {
    const jobs = parseFeed(RSS, "https://example.com/feed.xml")
    expect(jobs).toHaveLength(1)
    expect(jobs[0].title).toBe("Platform Engineer")
    expect(jobs[0].url).toBe("https://example.com/jobs/1")
    expect(jobs[0].date).toBe("2026-08-03")
    expect(jobs[0].description).toContain("Kubernetes")
  })

  test("parses Atom entries", () => {
    const jobs = parseFeed(ATOM, "https://example.com/atom.xml")
    expect(jobs[0].title).toBe("Data Analyst")
    expect(jobs[0].url).toBe("https://example.com/jobs/2")
  })
})

describe("parseFeedsFile", () => {
  test("reads JSON feeds array", () => {
    expect(parseFeedsFile(JSON.stringify({ feeds: ["https://a.com", "https://b.com"] }))).toEqual([
      "https://a.com",
      "https://b.com",
    ])
  })

  test("reads one URL per line and ignores comments", () => {
    expect(parseFeedsFile("# hi\nhttps://a.com\n\nhttps://b.com\n")).toEqual(["https://a.com", "https://b.com"])
  })
})
