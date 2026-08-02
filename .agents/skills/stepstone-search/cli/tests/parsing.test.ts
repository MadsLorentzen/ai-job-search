import { describe, expect, test } from "bun:test";
import {
  buildDetailUrl,
  buildSearchUrl,
  firstLeafText,
  parseGermanRelativeDate,
  parseJobDetail,
  parseSearchResults,
  slugify,
} from "../src/helpers";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Machine Learning Engineer")).toBe("machine-learning-engineer");
  });
  test("transliterates German umlauts", () => {
    expect(slugify("Düsseldorf")).toBe("duesseldorf");
    expect(slugify("Straße")).toBe("strasse");
  });
});

describe("buildSearchUrl / buildDetailUrl", () => {
  test("folds location into the path, keeps only ?q= in the query string", () => {
    const url = buildSearchUrl("Data Scientist", "Stuttgart");
    expect(url).toBe("https://www.stepstone.de/jobs/data-scientist/in-stuttgart?q=Data%20Scientist");
  });
  test("omits the /in-<city> segment when no location is given", () => {
    const url = buildSearchUrl("Data Scientist");
    expect(url).toBe("https://www.stepstone.de/jobs/data-scientist?q=Data%20Scientist");
  });
  test("detail URL uses a decorative slug and the numeric id", () => {
    expect(buildDetailUrl("14338328")).toBe("https://www.stepstone.de/stellenangebote--job--14338328-inline.html");
  });
});

describe("parseGermanRelativeDate", () => {
  const now = new Date("2026-08-02T12:00:00Z");
  test("Tagen", () => {
    expect(parseGermanRelativeDate("vor 4 Tagen", now)).toBe("2026-07-29");
  });
  test("Heute", () => {
    expect(parseGermanRelativeDate("Heute", now)).toBe("2026-08-02");
  });
  test("Gestern", () => {
    expect(parseGermanRelativeDate("Gestern", now)).toBe("2026-08-01");
  });
  test("Wochen", () => {
    expect(parseGermanRelativeDate("vor 2 Wochen", now)).toBe("2026-07-19");
  });
  test("unparseable input returns null rather than guessing", () => {
    expect(parseGermanRelativeDate("irgendwann", now)).toBeNull();
    expect(parseGermanRelativeDate(null, now)).toBeNull();
  });
});

describe("firstLeafText", () => {
  test("skips empty wrapper tags and an inline svg to find the leaf text", () => {
    const html = '<span data-at="x"><span><svg><path d="M1 1"></path></svg><div>ALH Gruppe</div></span></span>';
    const idx = html.indexOf('data-at="x"');
    expect(firstLeafText(html, idx)).toBe("ALH Gruppe");
  });
  test("returns null when no text is found within the window", () => {
    const html = '<span data-at="x"><span><i></i></span></span>';
    const idx = html.indexOf('data-at="x"');
    expect(firstLeafText(html, idx)).toBeNull();
  });
  test("decodes HTML entities in the leaf text", () => {
    const html = '<span data-at="x"><div>Tom &amp; Jerry GmbH</div></span>';
    const idx = html.indexOf('data-at="x"');
    expect(firstLeafText(html, idx)).toBe("Tom & Jerry GmbH");
  });
});

// Minimal synthetic fixture mirroring the real markup structure captured from a
// live search-results page (see url-reference.md): one <article data-at="job-item">
// per card, each field behind its own data-at="job-item-*" marker.
function fakeCard(id: string, title: string, company: string, location: string, timeago: string): string {
  return (
    `<article data-genesis-element="CARD" id="job-item-${id}" data-at="job-item" data-testid="job-item">` +
    `<a class="x" data-genesis-element="ANCHOR" href="/stellenangebote--Some-Title--${id}-inline.html" data-testid="job-item-title" data-at="job-item-title"><div>${title}</div></a>` +
    `<span data-at="job-item-company-name"><span><svg><path d="M1 1"></path></svg><div>${company}</div></span></span>` +
    `<span data-at="job-item-location"><span><svg><path d="M1 1"></path></svg><span>${location}</span></span></span>` +
    `<span data-at="job-item-timeago"><time>${timeago}</time></span>` +
    `</article>`
  );
}

describe("parseSearchResults", () => {
  test("parses multiple cards independently and reads the total count", () => {
    const html =
      `<div data-resultlist-offers-total="45"></div>` +
      fakeCard("111", "Senior ML Engineer", "ALH Gruppe", "Stuttgart", "vor 4 Tagen") +
      fakeCard("222", "Data Scientist", "Bosch", "Berlin", "Heute");

    const { total, results } = parseSearchResults(html);
    expect(total).toBe(45);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "111",
      title: "Senior ML Engineer",
      company: "ALH Gruppe",
      location: "Stuttgart",
      url: "https://www.stepstone.de/stellenangebote--Some-Title--111-inline.html",
    });
    expect(results[1].company).toBe("Bosch");
  });

  test("a malformed card (no title anchor) is skipped, not fatal to the rest", () => {
    const broken = `<article id="job-item-999" data-at="job-item"><span data-at="job-item-company-name"><div>X</div></span></article>`;
    const html = broken + fakeCard("111", "Senior ML Engineer", "ALH Gruppe", "Stuttgart", "vor 4 Tagen");

    const { results } = parseSearchResults(html);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("111");
  });

  test("missing optional fields are null, never omitted", () => {
    const html = `<article id="job-item-333" data-at="job-item"><a href="/stellenangebote--x--333-inline.html" data-at="job-item-title"><div>Title Only</div></a></article>`;
    const { results } = parseSearchResults(html);
    expect(results[0]).toMatchObject({
      id: "333",
      title: "Title Only",
      company: null,
      location: null,
      date: null,
      employmentType: null,
    });
  });
});

describe("parseJobDetail", () => {
  test("extracts title, company, location, salary, and description text", () => {
    const html =
      `<h1 data-at="header-job-title">Senior ML Engineer</h1>` +
      `<span data-at="metadata-company-name"><div>ALH Gruppe</div></span>` +
      `<span data-at="metadata-location"><div>Stuttgart</div></span>` +
      // Document order mirrors the real page: content, then the salary
      // section (heading before value), then the company card.
      `<div data-at="job-ad-content"><style>.x{color:red}</style><p>We are hiring.</p><p>Apply now.</p></div>` +
      `<div data-at="job-ad-salary"><h4 data-at="section-heading">Gehalt</h4><div data-at="section-text-gehalt-content"><span>50.000 € - 65.000 €</span></div></div>` +
      `<div data-at="job-ad-company-card">unrelated</div>`;

    const job = parseJobDetail(html, "14338328");
    expect(job.title).toBe("Senior ML Engineer");
    expect(job.company).toBe("ALH Gruppe");
    expect(job.location).toBe("Stuttgart");
    expect(job.salary).toBe("50.000 € - 65.000 €");
    expect(job.description).toContain("We are hiring.");
    expect(job.description).toContain("Apply now.");
    expect(job.description).not.toContain("color:red");
    expect(job.description).not.toContain('data-at="job-ad-content"');
    expect(job.description).not.toContain("Gehalt");
    expect(job.url).toBe("https://www.stepstone.de/stellenangebote--job--14338328-inline.html");
  });

  test("a salary 'reveal' teaser CTA (no computed estimate) is treated as absent, not a value", () => {
    const html =
      `<div data-at="job-ad-content"><p>Some job.</p></div>` +
      `<div data-at="job-ad-salary"><h4 data-at="section-heading">Gehalt</h4><div data-at="section-text-gehalt-content"><span>Neugierig auf das Gehalt für diesen Job?</span></div></div>`;
    const job = parseJobDetail(html, "1");
    expect(job.salary).toBeNull();
  });

  test("falls back to (untitled) and null fields when markers are absent", () => {
    const job = parseJobDetail("<div>nothing here</div>", "1");
    expect(job.title).toBe("(untitled)");
    expect(job.company).toBeNull();
    expect(job.description).toBeNull();
  });
});
