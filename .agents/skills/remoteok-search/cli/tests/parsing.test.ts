import { describe, test, expect } from "bun:test";
import {
  decodeHtmlEntities,
  extractDivContent,
  stripTags,
  matchesQuery,
  matchesLocation,
  daysSince,
  primaryTag,
  type JobCard,
} from "../src/helpers";

function card(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "1",
    title: "Backend Engineer",
    company: "Acme",
    location: null,
    date: new Date().toISOString(),
    url: "https://remoteok.com/remote-jobs/1",
    tags: ["node", "backend"],
    salaryMin: null,
    salaryMax: null,
    ...overrides,
  };
}

describe("decodeHtmlEntities", () => {
  test("decodes hexadecimal numeric entities (&#xE9;)", () => {
    expect(decodeHtmlEntities("Caf&#xE9; Manager")).toBe("Café Manager");
  });

  test("decodes decimal numeric entities (&#233;)", () => {
    expect(decodeHtmlEntities("Caf&#233; Lead")).toBe("Café Lead");
  });

  test("decodes supplementary-plane code points (&#128512;)", () => {
    expect(decodeHtmlEntities("Growth &#128512;")).toBe("Growth 😀");
  });

  test("decodes basic entities", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry &lt;3&gt;")).toBe("Tom & Jerry <3>");
  });
});

describe("stripTags", () => {
  test("converts <br> and block-close tags to newlines", () => {
    const html = "<p>Line one</p><p>Line two<br>Line three</p>";
    expect(stripTags(html)).toBe("Line one\nLine two\nLine three");
  });

  test("collapses excessive blank lines", () => {
    const html = "<div>A</div>\n\n\n\n<div>B</div>";
    expect(stripTags(html)).toBe("A\n\nB");
  });
});

describe("extractDivContent", () => {
  test("extracts simple div content", () => {
    const html = '<div class="description" itemprop="description">Simple text</div>';
    expect(extractDivContent(html, "description")).toBe("Simple text");
  });

  test("handles nested divs without stopping early", () => {
    const html = `<div class="description" itemprop="description">
      <div>Requirements:</div>
      <ul><li>5 years Node.js</li></ul>
    </div>`;
    const extracted = extractDivContent(html, "description");
    expect(extracted).toContain("Requirements:");
    expect(extracted).toContain("5 years Node.js");
  });

  test("returns null when class not found", () => {
    expect(extractDivContent("<div>no class</div>", "nonexistent")).toBeNull();
  });
});

describe("matchesQuery", () => {
  test("matches on title", () => {
    expect(matchesQuery(card({ title: "Senior Backend Engineer" }), "backend")).toBe(true);
  });

  test("matches on tags", () => {
    expect(matchesQuery(card({ tags: ["nestjs", "typescript"] }), "nestjs")).toBe(true);
  });

  test("requires every whitespace-separated term to match", () => {
    expect(matchesQuery(card({ title: "Backend Engineer" }), "backend ruby")).toBe(false);
    expect(matchesQuery(card({ title: "Backend Ruby Engineer" }), "backend ruby")).toBe(true);
  });

  test("no query always matches", () => {
    expect(matchesQuery(card(), undefined)).toBe(true);
  });
});

describe("matchesLocation", () => {
  test("no location filter always matches", () => {
    expect(matchesLocation(card(), undefined)).toBe(true);
  });

  test("'remote' matches a blank/null location", () => {
    expect(matchesLocation(card({ location: null }), "remote")).toBe(true);
  });

  test("'remote' matches an explicit Worldwide location", () => {
    expect(matchesLocation(card({ location: "Worldwide" }), "remote")).toBe(true);
  });

  test("'remote' does not match a specific non-remote location", () => {
    expect(matchesLocation(card({ location: "New York, USA (on-site)" }), "remote")).toBe(false);
  });

  test("substring match for a specific place", () => {
    expect(matchesLocation(card({ location: "USA Only" }), "usa")).toBe(true);
    expect(matchesLocation(card({ location: "Europe Only" }), "usa")).toBe(false);
  });
});

describe("daysSince", () => {
  test("returns Infinity for a null date", () => {
    expect(daysSince(null)).toBe(Infinity);
  });

  test("returns Infinity for an unparseable date", () => {
    expect(daysSince("not-a-date")).toBe(Infinity);
  });

  test("returns ~0 for a date of right now", () => {
    expect(daysSince(new Date().toISOString())).toBeLessThan(0.01);
  });

  test("returns ~10 for a date 10 days ago", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    expect(daysSince(tenDaysAgo)).toBeGreaterThan(9.9);
    expect(daysSince(tenDaysAgo)).toBeLessThan(10.1);
  });
});

describe("primaryTag", () => {
  test("returns undefined for an undefined/empty query", () => {
    expect(primaryTag(undefined)).toBeUndefined();
    expect(primaryTag("")).toBeUndefined();
  });

  test("returns the first lowercased token", () => {
    expect(primaryTag("Backend Engineer")).toBe("backend");
  });

  test("trims surrounding whitespace before splitting", () => {
    expect(primaryTag("  nodejs  developer ")).toBe("nodejs");
  });
});
