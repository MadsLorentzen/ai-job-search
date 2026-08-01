import { describe, test, expect } from "bun:test";
import {
  decodeHtmlEntities,
  stripTags,
  cleanDescription,
  splitTitle,
  slugFromUrl,
  parseFeed,
  parseFeedDetail,
  matchesQuery,
  matchesRegion,
  daysSince,
  feedUrlForCategory,
  type JobCard,
} from "../src/helpers";

function rssItem(opts: {
  title: string;
  link: string;
  region?: string;
  category?: string;
  pubDate?: string;
  description?: string;
}): string {
  return `<item>
    <title>${opts.title}</title>
    <region>${opts.region ?? "Anywhere in the World"}</region>
    <category>${opts.category ?? "Full-Stack Programming"}</category>
    <pubDate>${opts.pubDate ?? "Wed, 22 Jul 2026 07:00:51 +0000"}</pubDate>
    <link>${opts.link}</link>
    <guid>${opts.link}</guid>
    <description>${opts.description ?? "&lt;p&gt;Job body&lt;/p&gt;"}</description>
  </item>`;
}

describe("decodeHtmlEntities", () => {
  test("decodes hexadecimal numeric entities (&#xE9;)", () => {
    expect(decodeHtmlEntities("Caf&#xE9; Manager")).toBe("Café Manager");
  });

  test("decodes basic entities", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry &lt;3&gt;")).toBe("Tom & Jerry <3>");
  });
});

describe("stripTags / cleanDescription", () => {
  test("strips tags and converts <br>/block-close to newlines", () => {
    expect(stripTags("<p>Line one</p><p>Line two<br>Line three</p>")).toBe(
      "Line one\nLine two\nLine three",
    );
  });

  test("cleanDescription decodes entities then strips tags", () => {
    const raw = "&lt;p&gt;Hello &amp; welcome&lt;/p&gt;";
    expect(cleanDescription(raw)).toBe("Hello & welcome");
  });
});

describe("splitTitle", () => {
  test("splits 'Company: Job Title' on the first colon-space", () => {
    expect(splitTitle("Cloudflare: Principal Engineer")).toEqual({
      company: "Cloudflare",
      position: "Principal Engineer",
    });
  });

  test("handles a colon inside the job title itself", () => {
    expect(splitTitle("Acme: Senior Engineer: Payments")).toEqual({
      company: "Acme",
      position: "Senior Engineer: Payments",
    });
  });

  test("falls back to the whole string as position when there's no colon", () => {
    expect(splitTitle("Just A Title")).toEqual({ company: null, position: "Just A Title" });
  });
});

describe("slugFromUrl", () => {
  test("extracts the trailing path segment", () => {
    expect(slugFromUrl("https://weworkremotely.com/remote-jobs/acme-backend-engineer")).toBe(
      "acme-backend-engineer",
    );
  });

  test("strips a trailing slash before extracting", () => {
    expect(slugFromUrl("https://weworkremotely.com/remote-jobs/acme-backend-engineer/")).toBe(
      "acme-backend-engineer",
    );
  });
});

describe("parseFeed / parseFeedDetail", () => {
  test("parses a single item into a JobCard", () => {
    const xml = `<rss><channel>${rssItem({
      title: "Acme: Backend Engineer",
      link: "https://weworkremotely.com/remote-jobs/acme-backend-engineer",
    })}</channel></rss>`;
    const [card] = parseFeed(xml);
    expect(card.id).toBe("acme-backend-engineer");
    expect(card.title).toBe("Backend Engineer");
    expect(card.company).toBe("Acme");
    expect(card.region).toBe("Anywhere in the World");
  });

  test("one malformed item does not break parsing of the rest", () => {
    const good1 = rssItem({ title: "Acme: Backend Engineer", link: "https://weworkremotely.com/remote-jobs/one" });
    const malformed = "<item><title>No link here</title></item>";
    const good2 = rssItem({ title: "Beta: Frontend Engineer", link: "https://weworkremotely.com/remote-jobs/two" });
    const xml = `<rss><channel>${good1}${malformed}${good2}</channel></rss>`;
    const cards = parseFeed(xml);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.id)).toEqual(["one", "two"]);
  });

  test("parseFeedDetail decodes and strips the description", () => {
    const xml = `<rss><channel>${rssItem({
      title: "Acme: Backend Engineer",
      link: "https://weworkremotely.com/remote-jobs/acme-backend-engineer",
      description: "&lt;p&gt;Build things.&lt;/p&gt;&lt;p&gt;Apply now.&lt;/p&gt;",
    })}</channel></rss>`;
    const [job] = parseFeedDetail(xml);
    expect(job.description).toBe("Build things.\nApply now.");
  });
});

function card(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "acme-backend-engineer",
    title: "Backend Engineer",
    company: "Acme",
    region: "Anywhere in the World",
    category: "Full-Stack Programming",
    date: new Date().toUTCString(),
    url: "https://weworkremotely.com/remote-jobs/acme-backend-engineer",
    ...overrides,
  };
}

describe("matchesQuery", () => {
  test("matches on title/company/category", () => {
    expect(matchesQuery(card(), "backend")).toBe(true);
    expect(matchesQuery(card(), "acme")).toBe(true);
    expect(matchesQuery(card(), "full-stack")).toBe(true);
  });

  test("requires every term to match", () => {
    expect(matchesQuery(card({ title: "Backend Engineer" }), "backend ruby")).toBe(false);
  });

  test("no query always matches", () => {
    expect(matchesQuery(card(), undefined)).toBe(true);
  });
});

describe("matchesRegion", () => {
  test("no filter always matches", () => {
    expect(matchesRegion(card(), undefined)).toBe(true);
  });

  test("substring match is case-insensitive", () => {
    expect(matchesRegion(card({ region: "US Only" }), "us")).toBe(true);
    expect(matchesRegion(card({ region: "Europe Only" }), "us")).toBe(false);
  });

  test("null region never matches a filter", () => {
    expect(matchesRegion(card({ region: null }), "us")).toBe(false);
  });
});

describe("daysSince", () => {
  test("returns Infinity for a null/unparseable date", () => {
    expect(daysSince(null)).toBe(Infinity);
    expect(daysSince("not-a-date")).toBe(Infinity);
  });

  test("parses RFC 822 pubDate format", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toUTCString();
    const days = daysSince(tenDaysAgo);
    expect(days).toBeGreaterThan(9.9);
    expect(days).toBeLessThan(10.1);
  });
});

describe("feedUrlForCategory", () => {
  test("defaults to the all-jobs feed", () => {
    expect(feedUrlForCategory(undefined)).toBe("https://weworkremotely.com/remote-jobs.rss");
  });

  test("builds a category feed URL from a bare slug", () => {
    expect(feedUrlForCategory("back-end-programming")).toBe(
      "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
    );
  });

  test("is idempotent when passed an already-full slug", () => {
    expect(feedUrlForCategory("remote-back-end-programming-jobs")).toBe(
      "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
    );
  });
});
