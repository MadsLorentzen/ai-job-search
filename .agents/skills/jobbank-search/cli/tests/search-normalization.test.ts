import { describe, expect, test } from "bun:test";
import { normalizeSearchItem } from "../src/commands/search";
import type { RssItem } from "../src/helpers";

function rssItem(): RssItem {
  return {
    title: "Data Scientist",
    description: "Fuldtidsjob hos Acme A/S, København (Ansøgningsfrist: 31.07.2026)",
    link: "https://jobbank.dk/job/12345/acme/data-scientist",
    pubDate: "Fri, 14 Aug 2026 09:30:00 +0200",
  };
}

describe("Jobbank search normalization", () => {
  test("derives the /scrape contract date from posted as YYYY-MM-DD", () => {
    const result = normalizeSearchItem(rssItem());

    expect(result.posted).toBe("2026-08-14T07:30:00.000Z");
    expect(result.date).toBe((result.posted as string).slice(0, 10));
    expect(result.date).toBe("2026-08-14");
  });

  test("emits a null date when pubDate is absent (posted is empty)", () => {
    const result = normalizeSearchItem({ ...rssItem(), pubDate: "" });

    expect(result.posted).toBe("");
    expect(result.date).toBeNull();
  });

  // A present-but-unparseable pubDate must degrade to the same null-date shape
  // as an absent one, never throw: toISOString() on an Invalid Date raises
  // RangeError, and normalizeSearchItem runs inside an unguarded items.map(),
  // so one bad feed item killed the whole search as API_ERROR (#416). The
  // un-CDATA'd fallback capture in parseRssItems can deliver exactly such a
  // value.
  for (const bad of ["date unavailable", "2026-09-02T08:00:00+02:00x", "I går"]) {
    test(`emits a null date instead of throwing on unparseable pubDate ${JSON.stringify(bad)}`, () => {
      const result = normalizeSearchItem({ ...rssItem(), pubDate: bad });

      expect(result.posted).toBe("");
      expect(result.date).toBeNull();
    });
  }

  test("keeps the native fields alongside the contract date (additive)", () => {
    const result = normalizeSearchItem(rssItem());

    expect(result.company).toBe("Acme A/S");
    expect(result.location).toBe("København");
    expect(result.url).toBe("https://jobbank.dk/job/12345/acme/data-scientist");
    expect(result.deadline).toBe("2026-07-31");
  });
});