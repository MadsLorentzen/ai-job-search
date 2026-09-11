import { describe, expect, test } from "bun:test";
import { matchSitemap, parseJobDetail, slugify, type SitemapEntry } from "../src/helpers";

describe("slugify", () => {
  test("transliterates German umlauts and ß the way Xing's own slugs do", () => {
    expect(slugify("Köln")).toBe("koeln");
    expect(slugify("Düsseldorf")).toBe("duesseldorf");
    expect(slugify("Straße")).toBe("strasse");
  });

  test("lowercases and collapses non-alphanumerics to single hyphens", () => {
    expect(slugify("Embedded Software Engineer (m/w/d)")).toBe("embedded-software-engineer-m-w-d");
  });

  test("trims leading/trailing hyphens", () => {
    expect(slugify("  Projektleiter!  ")).toBe("projektleiter");
  });
});

describe("matchSitemap", () => {
  const entries: SitemapEntry[] = [
    { id: "koeln-ot-cyber-security-senior-consultant-100000001", url: "https://www.xing.com/jobs/koeln-ot-cyber-security-senior-consultant-100000001" },
    { id: "berlin-junior-service-consultant-microsoft-dynamics-100000002", url: "https://www.xing.com/jobs/berlin-junior-service-consultant-microsoft-dynamics-100000002" },
    { id: "frankfurt-embedded-software-engineer-100000003", url: "https://www.xing.com/jobs/frankfurt-embedded-software-engineer-100000003" },
    { id: "muenchen-embedded-software-engineer-100000004", url: "https://www.xing.com/jobs/muenchen-embedded-software-engineer-100000004" },
  ];

  test("requires every query word to appear in the slug (AND match)", () => {
    const matches = matchSitemap(entries, ["embedded", "software"], []);
    expect(matches.map((m) => m.id)).toEqual([
      "muenchen-embedded-software-engineer-100000004",
      "frankfurt-embedded-software-engineer-100000003",
    ]);
  });

  test("sorts matches by trailing numeric id descending (newest-looking first)", () => {
    const matches = matchSitemap(entries, ["embedded"], []);
    expect(matches[0].id).toContain("100000004");
    expect(matches[1].id).toContain("100000003");
  });

  test("location words are OR-matched and additionally required", () => {
    const matches = matchSitemap(entries, ["embedded"], ["frankfurt"]);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toContain("frankfurt");
  });

  test("no matches when a query word appears nowhere", () => {
    expect(matchSitemap(entries, ["nonexistent-keyword"], [])).toHaveLength(0);
  });
});

describe("parseJobDetail", () => {
  function pageWithJsonLd(posting: object): string {
    return `<html><head><script data-ch type="application/ld+json">${JSON.stringify(posting)}</script></head></html>`;
  }

  const BASE_POSTING = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: "Embedded Software Engineer (m/w/d)",
    description: "<H3>Frankfurt</H3><ARTICLE><P>Do the thing &amp; more</P></ARTICLE>",
    datePosted: "2026-01-01T00:00:00Z",
    employmentType: "FULL_TIME",
    industry: "Automotive",
    hiringOrganization: { "@type": "Organization", name: "Acme GmbH" },
    jobLocation: [{ "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Frankfurt", addressRegion: "Hessen" } }],
  };

  test("maps schema.org JobPosting fields onto the JobDetail contract", () => {
    const html = pageWithJsonLd({ ...BASE_POSTING, validThrough: "2099-01-01T00:00:00Z" });
    const detail = parseJobDetail(html, "frankfurt-embedded-software-engineer-1", "https://www.xing.com/jobs/frankfurt-embedded-software-engineer-1");

    expect(detail).not.toBeNull();
    expect(detail!.title).toBe("Embedded Software Engineer (m/w/d)");
    expect(detail!.company).toBe("Acme GmbH");
    expect(detail!.location).toBe("Frankfurt, Hessen");
    expect(detail!.date).toBe("2026-01-01T00:00:00Z");
    expect(detail!.description).toContain("Do the thing & more");
    expect(detail!.isActive).toBe(true);
  });

  test("a validThrough in the past marks the posting inactive", () => {
    const html = pageWithJsonLd({ ...BASE_POSTING, validThrough: "2000-01-01T00:00:00Z" });
    const detail = parseJobDetail(html, "id", "url");
    expect(detail!.isActive).toBe(false);
  });

  test("a missing validThrough is unknown liveness, never inferred", () => {
    const html = pageWithJsonLd(BASE_POSTING);
    const detail = parseJobDetail(html, "id", "url");
    expect(detail!.isActive).toBeNull();
  });

  test("returns null when the page carries no JobPosting JSON-LD (markup drift)", () => {
    expect(parseJobDetail("<html><body>nothing here</body></html>", "id", "url")).toBeNull();
  });
});
