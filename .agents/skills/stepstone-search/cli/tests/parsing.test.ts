import { describe, test, expect } from "bun:test";
import { parseJobCards, parseJobDetail, slugify, buildSearchUrl } from "../src/helpers";

// Minimal synthetic markup matching StepStone's real card structure: split on
// `data-at="job-item" data-testid="job-item"`, title/company/location text sits behind an
// icon+text pair where the actual text is the LAST "TEXT" or "BASE" genesis-element in the
// window before the next data-at="..." marker (see helpers.ts's lastLeafText/metadataText).
function card(id: string, title: string, company: string, location: string, timeago?: string): string {
  return `data-at="job-item" data-testid="job-item"><div>
    <a data-genesis-element="ANCHOR" href="/stellenangebote--Slug--${id}-inline.html" data-testid="job-item-title" data-at="job-item-title">
      <span data-genesis-element="TEXT"><div data-genesis-element="BASE">${title}</div></span>
    </a>
    <span data-at="job-item-company-name"><svg><path d="M1"/></svg><span data-genesis-element="TEXT"><div data-genesis-element="BASE">${company}</div></span></span>
    <span data-at="job-item-location"><svg><path d="M1"/></svg><span data-genesis-element="TEXT">${location}</span></span>
    ${timeago ? `<span data-at="job-item-timeago"><time class="">${timeago}</time></span>` : ""}
  </div>`;
}

describe("parseJobCards", () => {
  test("extracts id, title, company, location, date, url from a card", () => {
    const html = card("14255090", "Product Manager", "N26 GmbH", "Berlin", "vor 2 Tagen");
    const [c] = parseJobCards(html);
    expect(c!.id).toBe("14255090");
    expect(c!.title).toBe("Product Manager");
    expect(c!.company).toBe("N26 GmbH");
    expect(c!.location).toBe("Berlin");
    expect(c!.date).toBe("vor 2 Tagen");
    expect(c!.url).toBe("https://www.stepstone.de/stellenangebote--Slug--14255090-inline.html");
  });

  test("date is null when the timeago marker is absent (e.g. a sponsored card)", () => {
    const html = card("14300000", "Product Owner", "Acme GmbH", "Munich");
    const [c] = parseJobCards(html);
    expect(c!.date).toBeNull();
  });

  test("parses multiple cards independently, one malformed card does not break the rest", () => {
    const good1 = card("111", "Role One", "Company One", "Berlin");
    const malformed = `data-at="job-item" data-testid="job-item"><div>no title anchor here</div>`;
    const good2 = card("222", "Role Two", "Company Two", "Hamburg");
    const html = good1 + malformed + good2;
    const results = parseJobCards(html);
    expect(results.map((r) => r.id)).toEqual(["111", "222"]);
  });

  test("decodes HTML entities in title and company", () => {
    const html = card("333", "Produktmanager &amp; Team", "M&#252;ller GmbH", "Köln");
    const [c] = parseJobCards(html);
    expect(c!.title).toBe("Produktmanager & Team");
    expect(c!.company).toBe("Müller GmbH");
  });

  test("returns an empty array for a page with no job cards", () => {
    expect(parseJobCards("<html><body>No jobs found</body></html>")).toEqual([]);
  });
});

describe("parseJobDetail", () => {
  function detailHtml(): string {
    return `
      <h1 data-at="header-job-title">Product Manager - Product Factory</h1>
      <li data-at="metadata-company-name"><svg><path d="M1"/></svg><span>N26 GmbH</span></li>
      <li data-at="metadata-location"><svg><path d="M1"/></svg><span>Berlin</span></li>
      <li data-at="metadata-contract-type"><svg><path d="M1"/></svg><span>Feste Anstellung</span></li>
      <li data-at="metadata-work-type"><svg><path d="M1"/></svg><span>Homeoffice möglich, Vollzeit</span></li>
      <li data-at="metadata-online-date"><svg><path d="M1"/></svg><span>Erschienen: vor 2 Tagen</span></li>
      <div data-at="section-text-description-content"><p>First paragraph.</p><ul><li>Bullet one</li><li>Bullet two</li></ul></div>
      <div data-at="section-text-profile-content"><p>Requirement text.</p></div>
      <div data-at="section-text-benefits-content"><p>Benefit text.</p></div>
      <div data-at="section-text-additionalInformation">Contact info here</div>
    `;
  }

  test("extracts title, company, location, contract type, work type, online date", () => {
    const d = parseJobDetail(detailHtml(), "14255090", "https://www.stepstone.de/x");
    expect(d.title).toBe("Product Manager - Product Factory");
    expect(d.company).toBe("N26 GmbH");
    expect(d.location).toBe("Berlin");
    expect(d.contractType).toBe("Feste Anstellung");
    expect(d.workType).toBe("Homeoffice möglich, Vollzeit");
    expect(d.onlineDate).toBe("Erschienen: vor 2 Tagen");
    expect(d.date).toBe("Erschienen: vor 2 Tagen");
  });

  test("joins description, profile, and benefits sections without leaking markup from the next section", () => {
    const d = parseJobDetail(detailHtml(), "1", "https://www.stepstone.de/x");
    expect(d.description).toContain("First paragraph.");
    expect(d.description).toContain("Bullet one");
    expect(d.description).toContain("Requirement text.");
    expect(d.description).toContain("Benefit text.");
    expect(d.description).not.toContain("Contact info here");
    expect(d.description).not.toContain("<");
  });

  test("applyUrl is always null (the apply button is client-side rendered, not extractable)", () => {
    const d = parseJobDetail(detailHtml(), "1", "https://www.stepstone.de/x");
    expect(d.applyUrl).toBeNull();
  });

  test("missing metadata fields are null, not omitted", () => {
    const d = parseJobDetail("<h1 data-at=\"header-job-title\">Title Only</h1>", "1", "https://www.stepstone.de/x");
    expect(d.company).toBeNull();
    expect(d.location).toBeNull();
    expect(d.description).toBeNull();
  });
});

describe("slugify / buildSearchUrl", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Product Owner")).toBe("product-owner");
  });

  test("transliterates German umlauts and eszett", () => {
    expect(slugify("München")).toBe("muenchen");
    expect(slugify("Straße")).toBe("strasse");
  });

  test("buildSearchUrl with query and location", () => {
    expect(buildSearchUrl("Product Owner", "Berlin")).toBe("https://www.stepstone.de/jobs/product-owner/in-berlin");
  });

  test("buildSearchUrl with query only (no location segment)", () => {
    expect(buildSearchUrl("Produktmanager Zahlungsverkehr", undefined)).toBe(
      "https://www.stepstone.de/jobs/produktmanager-zahlungsverkehr",
    );
  });
});
