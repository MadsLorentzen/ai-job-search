import { describe, test, expect } from "bun:test";
import { parseJobCards, parseJobDetail, relativeToDate } from "../src/helpers";
import { resolveSlug } from "../src/commands/detail";

const CARD_HTML = `
<ul>
<li class="d-flex justify-content-between position-relative pb-2">
  <div>
    <div>
      <a class="font-monospace fw-bold stretched-link" href="/job/data-analyst-richardson-tx-us-231820/" target="_blank">
        Data Analyst
      </a>
      <span class="text-bg-success px-1 rounded">USD 68K-88K</span>
    </div>
    <div>
      <span>Blazor</span> | <span>C#</span> | <span>Power BI</span>
    </div>
    <div></div>
  </div>
  <div class="text-end">
    <div>
      <span class="text-bg-warning px-1 rounded">Mid-level</span>
      <span class="text-bg-secondary px-1 rounded">Full Time</span>
    </div>
    <div>
      Richardson, TX, US
    </div>
    <div class="text-muted">7d ago</div>
  </div>
</li>
</ul>`;

const DETAIL_HTML = `
<h1 class="font-monospace fs-2 py-3">Data Analyst</h1>
<div class="row">
  <div class="col">
    <strong>Richardson, TX, US</strong>
    <p class="py-4">
      <span class="text-bg-success px-1 rounded">USD 68K-88K</span>
      <span class="text-bg-warning px-1 rounded">Mid-level</span>
      <span class="text-bg-secondary px-1 rounded">Full Time</span>
    </p>
  </div>
  <div class="col-6 text-end">
    <div class="fw-bold mb-2">
      <a class="text-decoration-none d-block text-break" href="/company/outreach-health-17823/">@ O...</a>
    </div>
    <a class="btn btn-primary" href="/job/iKpGfCRsiiJuriZ/apply/" rel="nofollow">Apply</a>
    <span class="d-block text-muted py-2">Found 1h ago</span>
  </div>
</div>
<h5>Tasks</h5>
<ul><li>Develop and optimize SQL queries</li><li>Support Power BI reporting</li></ul>
<h5>Perks/Benefits</h5>
<ul><li>N/A</li></ul>
<h5>Skills/Tech-stack</h5>
<p><a href="/jobs/skill-power-bi/">Power BI</a> | <a href="/jobs/skill-sql/">SQL</a></p>
<h5>Roles</h5>
<p><a href="/jobs/role-analyst/">Analyst</a></p>`;

describe("parseJobCards", () => {
  const cards = parseJobCards(CARD_HTML);
  test("extracts exactly one card", () => {
    expect(cards.length).toBe(1);
  });
  test("id is the slug, url is well-formed", () => {
    expect(cards[0].id).toBe("data-analyst-richardson-tx-us-231820");
    expect(cards[0].url).toBe("https://aijobs.net/job/data-analyst-richardson-tx-us-231820/");
  });
  test("title, salary, level, type, location parsed", () => {
    expect(cards[0].title).toBe("Data Analyst");
    expect(cards[0].salary).toBe("USD 68K-88K");
    expect(cards[0].level).toBe("Mid-level");
    expect(cards[0].employmentType).toBe("Full Time");
    expect(cards[0].location).toBe("Richardson, TX, US");
  });
  test("skills parsed from tag row", () => {
    expect(cards[0].skills).toEqual(["Blazor", "C#", "Power BI"]);
  });
  test("company is null on listings (not exposed)", () => {
    expect(cards[0].company).toBeNull();
  });
  test("date is an ISO string derived from the relative age", () => {
    expect(cards[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("parseJobDetail", () => {
  const d = parseJobDetail(DETAIL_HTML, "data-analyst-richardson-tx-us-231820");
  test("title/location/salary/level/type", () => {
    expect(d.title).toBe("Data Analyst");
    expect(d.location).toBe("Richardson, TX, US");
    expect(d.salary).toBe("USD 68K-88K");
    expect(d.level).toBe("Mid-level");
    expect(d.employmentType).toBe("Full Time");
  });
  test("company derived from the /company/ slug (on-page name is obscured)", () => {
    expect(d.company).toBe("Outreach Health");
    expect(d.companyUrl).toBe("https://aijobs.net/company/outreach-health-17823/");
  });
  test("apply url absolutized", () => {
    expect(d.applyUrl).toBe("https://aijobs.net/job/iKpGfCRsiiJuriZ/apply/");
  });
  test("description includes Tasks & Skills but drops taxonomy + N/A", () => {
    expect(d.description).toContain("Tasks");
    expect(d.description).toContain("Develop and optimize SQL queries");
    expect(d.description).toContain("Skills/Tech-stack");
    expect(d.description).not.toContain("Roles");
    expect(d.description).not.toContain("N/A");
  });
});

describe("relativeToDate", () => {
  test("days unit", () => {
    expect(relativeToDate("7d ago").days).toBe(7);
  });
  test("hours count as today (0 days)", () => {
    expect(relativeToDate("3h ago").days).toBe(0);
  });
  test("weeks convert to days", () => {
    expect(relativeToDate("2w ago").days).toBe(14);
  });
  test("unparseable returns 0 days and null iso", () => {
    expect(relativeToDate("just now").iso).toBeNull();
  });
});

describe("resolveSlug", () => {
  test("full url", () => {
    expect(resolveSlug("https://aijobs.net/job/foo-bar-123/")).toBe("foo-bar-123");
  });
  test("bare slug", () => {
    expect(resolveSlug("foo-bar-123")).toBe("foo-bar-123");
  });
  test("bare numeric id is unresolvable", () => {
    expect(resolveSlug("231820")).toBeNull();
  });
});
