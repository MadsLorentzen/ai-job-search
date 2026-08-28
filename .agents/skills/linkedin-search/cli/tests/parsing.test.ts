import { describe, test, expect } from "bun:test";
import { parseJobCards, parseJobDetail, extractDivContent, minutesToTPR } from "../src/helpers";

// Minimal search-card markup: parseJobCards splits on the job-posting URN and
// needs an id, a base-search-card__title, and a full-link. Everything else is
// optional. We inject HTML entities into the title/company to exercise decoding.
function searchCard(id: string, title: string, company = "Acme"): string {
  return `<li>
    <div data-entity-urn="urn:li:jobPosting:${id}">
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/${id}"></a>
      <h3 class="base-search-card__title">${title}</h3>
      <h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/acme">${company}</a></h4>
    </div>
  </li>`;
}

// The /scrape contract fields beyond title/company. The original fixture had
// no <time> or location element at all, so deleting the date extraction from
// parseJobCards left every test green (review finding F35, 2026-08-19).
function searchCardWithMeta(id: string, datetimeAttr: string, listdateClass = "job-search-card__listdate"): string {
  return `<li>
    <div data-entity-urn="urn:li:jobPosting:${id}">
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/${id}"></a>
      <h3 class="base-search-card__title">Data Engineer</h3>
      <h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/acme">Acme</a></h4>
      <span class="job-search-card__location">Copenhagen, Denmark</span>
      <time class="${listdateClass}" datetime="${datetimeAttr}">3 days ago</time>
    </div>
  </li>`;
}

describe("parseJobCards contract fields", () => {
  test("extracts date from the listdate <time> element", () => {
    const [card] = parseJobCards(searchCardWithMeta("200", "2026-08-10"));
    expect(card.date).toBe("2026-08-10");
  });

  test("extracts date from the listdate--new variant class", () => {
    const [card] = parseJobCards(
      searchCardWithMeta("201", "2026-08-15", "job-search-card__listdate--new"),
    );
    expect(card.date).toBe("2026-08-15");
  });

  test("extracts location from the location span", () => {
    const [card] = parseJobCards(searchCardWithMeta("202", "2026-08-10"));
    expect(card.location).toBe("Copenhagen, Denmark");
  });

  test("date and location are null when the elements are absent", () => {
    const [card] = parseJobCards(searchCard("203", "Bare Card"));
    expect(card.date).toBeNull();
    expect(card.location).toBeNull();
  });
});

describe("decodeHtmlEntities (via parseJobCards)", () => {
  test("decodes hexadecimal numeric entities (&#xE9;)", () => {
    const [card] = parseJobCards(searchCard("123", "Caf&#xE9; Manager"));
    expect(card.title).toBe("Café Manager");
  });

  test("decodes uppercase-X hexadecimal entities (&#X...;)", () => {
    const [card] = parseJobCards(searchCard("124", "Deb&#XFC;t Role")); // &#XFC; = ü
    expect(card.title).toBe("Debüt Role");
  });

  test("still decodes decimal numeric entities (&#233;) — regression", () => {
    const [card] = parseJobCards(searchCard("125", "Caf&#233; Lead"));
    expect(card.title).toBe("Café Lead");
  });

  test("decodes supplementary-plane code points with fromCodePoint (&#128512;)", () => {
    const [card] = parseJobCards(searchCard("126", "Growth &#128512;"));
    expect(card.title).toBe("Growth 😀");
  });

  test("decodes hex supplementary-plane code points (&#x1F600;)", () => {
    const [card] = parseJobCards(searchCard("127", "Growth &#x1F600;"));
    expect(card.title).toBe("Growth 😀");
  });

  test("decodes hex entities in the company subtitle too", () => {
    const [card] = parseJobCards(searchCard("128", "Engineer", "N&#xF8;rrebro ApS"));
    expect(card.company).toBe("Nørrebro ApS");
  });
});

describe("parseJobDetail active-status detection", () => {
  // Captured from a real closed guest posting (2026-08-09): the banner LinkedIn
  // actually renders inside the top card. Its class and its visible text are the
  // only closed markers that occur in the wild.
  const closedBanner = `
    <figure class="closed-job closed-job__flavor topcard__flavor-row">
      <span class="closed-job__icon closed-job__icon--error-pebble lazy-load"></span>
      <figcaption class="closed-job__flavor--closed">No longer accepting applications</figcaption>
    </figure>`;

  const page = (topcardExtra: string, description: string) => `
    <h1 class="topcard__title">Data Engineer</h1>
    <span class="topcard__flavor topcard__flavor--bullet">Berlin</span>
    ${topcardExtra}
    <div class="show-more-less-html__markup">${description}</div>`;

  test("a closed posting's top-card banner yields isActive: false", () => {
    const job = parseJobDetail(page(closedBanner, "We build things."), "1");
    expect(job.isActive).toBe(false);
  });

  test("an open posting yields isActive: true", () => {
    const job = parseJobDetail(page("", "We are hiring!"), "2");
    expect(job.isActive).toBe(true);
  });

  test("recruiter boilerplate in the description does not flag a live posting", () => {
    // The review's false-positive case: the closed phrase appears in the
    // *description text* of a job that is very much open.
    const job = parseJobDetail(
      page("", "Apply soon - once filled, this posting is no longer accepting applications."),
      "3",
    );
    expect(job.isActive).toBe(true);
  });

  test("a closed-job class named in the description does not flag a live posting", () => {
    const job = parseJobDetail(
      page("", "Our design system documents a closed-job__flavor CSS class."),
      "4",
    );
    expect(job.isActive).toBe(true);
  });
});

describe("parseJobDetail dropped fields", () => {
  test("emits no applyUrl field", () => {
    // The extraction regex assumed class-before-href and never matched
    // LinkedIn's real markup (null on every live posting), and a fixed
    // version would only capture the job-view URL - a duplicate of `url`.
    // The field is dropped rather than fixed (review finding F19,
    // 2026-08-19). This test pins the removal so it does not quietly
    // return as a broken or redundant field.
    const job = parseJobDetail("<html></html>", "1");
    expect("applyUrl" in job).toBe(false);
  });
});

describe("decodeHtmlEntities (via parseJobDetail)", () => {
  test("decodes hex entities inside the job title", () => {
    const html = `<h1 class="topcard__title">Se&#xF1;or Engineer</h1>`;
    const job = parseJobDetail(html, "999");
    expect(job.title).toBe("Señor Engineer");
  });
});

describe("extractDivContent", () => {
  test("extracts content from simple div", () => {
    const html = '<div class="description__text">Simple text</div>';
    expect(extractDivContent(html, "description__text")).toBe("Simple text");
  });

  test("extracts content with nested divs — the regression case", () => {
    const html = `<div class="description__text">
      <div>Requirements:</div>
      <ul><li>Skill A</li></ul>
      <div>About Us:</div>
      <p>We are...</p>
    </div>`;
    expect(extractDivContent(html, "description__text")).toBe(
      '\n      <div>Requirements:</div>\n      <ul><li>Skill A</li></ul>\n      <div>About Us:</div>\n      <p>We are...</p>\n    ',
    );
  });

  test("returns null when class not found", () => {
    expect(extractDivContent("<div>no class</div>", "nonexistent")).toBeNull();
  });

  test("works with show-more-less-html__markup class", () => {
    const html = '<div class="show-more-less-html__markup">LinkedIn content</div>';
    expect(extractDivContent(html, "show-more-less-html__markup")).toBe("LinkedIn content");
  });

  test("handles deeply nested divs (3 levels)", () => {
    const html = `<div class="description__text">
      <div>
        <div>Deep content</div>
      </div>
    </div>`;
    expect(extractDivContent(html, "description__text")).toBe(
      '\n      <div>\n        <div>Deep content</div>\n      </div>\n    ',
    );
  });

  test("handles empty content", () => {
    const html = '<div class="description__text"></div>';
    expect(extractDivContent(html, "description__text")).toBe("");
  });

  test("parseJobDetail uses extractDivContent and preserves full description", () => {
    const html = `<div class="description__text">
      <div>Requirements:</div>
      <ul><li>5 years Python</li></ul>
      <div>About Us:</div>
      <p>We are hiring!</p>
    </div>`;
    const job = parseJobDetail(html, "999");
    expect(job.description).toContain("Requirements:");
    expect(job.description).toContain("5 years Python");
    expect(job.description).toContain("About Us:");
    expect(job.description).toContain("We are hiring!");
  });
});

describe("minutesToTPR", () => {
  test("converts minutes to an f_TPR seconds window", () => {
    expect(minutesToTPR(30)).toBe("r1800");
    expect(minutesToTPR(1)).toBe("r60");
    expect(minutesToTPR(1440)).toBe("r86400"); // matches jobageToTPR(1)
  });

  test("returns null for non-positive input", () => {
    expect(minutesToTPR(0)).toBeNull();
    expect(minutesToTPR(-5)).toBeNull();
  });
});
