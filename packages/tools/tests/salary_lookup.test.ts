/** Tests for salary_lookup — formatting, matching, search, validation, CLI. */
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  anglicize,
  collectValidationIssues,
  extractCoreWords,
  formatEntry,
  matchScore,
  normalize,
  salaryLookupMain,
  searchCompany,
  validateData,
  type CompanyEntry,
  type SalaryData,
} from "../src/salary_lookup.ts";

// ---------------------------------------------------------------------------
// formatEntry
// ---------------------------------------------------------------------------

describe("formatEntry", () => {
  test("zero count is displayed as zero", () => {
    const entry = {
      company: "Example Corp",
      city: "",
      categories: { public_data: { count: 0, index: 100.0 } },
    };
    const rendered = formatEntry(entry, { index_baseline: 100, index_label: "Index" });
    expect(rendered).toMatch(/Public Data\s+0\s+100\.0/);
  });

  test("text index does not crash", () => {
    const entry = {
      company: "Example Corp",
      city: "",
      categories: { sample: { count: 3, index: "private" } },
    };
    const rendered = formatEntry(entry, { index_baseline: 100, index_label: "Index" });
    expect(rendered).toContain("private");
  });

  test("zero baseline", () => {
    const entry = {
      company: "Example Corp",
      city: "",
      categories: { it: { count: null, index: 45000.0 } },
    };
    const rendered = formatEntry(entry, { index_baseline: 0, index_label: "Salary" });
    expect(rendered).toContain("45000.0");
    expect(rendered).not.toContain("%");
  });

  test("custom baseline", () => {
    const entry = {
      company: "Example Corp",
      city: "",
      categories: { it: { count: null, index: 45000.0 } },
    };
    const rendered = formatEntry(entry, { index_baseline: 40000, index_label: "Salary" });
    expect(rendered).toContain("45000.0");
    expect(rendered).toContain("+12.5%");
  });

  test("null categories with sibling dict does not crash", () => {
    const entry = {
      company: "Example Corp",
      city: "",
      categories: null,
      engineering: { count: 10, index: 105.0 },
    };
    const rendered = formatEntry(entry, { index_baseline: 100, index_label: "Index" });
    expect(rendered).toMatch(/Engineering\s+10\s+105\.0/);
  });

  test("null metadata does not crash", () => {
    const entry = {
      company: "Example Corp",
      city: "",
      categories: { eng: { count: 5, index: 108.0 } },
    };
    const rendered = formatEntry(entry, null);
    expect(rendered).toMatch(/Eng\s+5\s+108\.0/);
  });
});

// ---------------------------------------------------------------------------
// matchScore
// ---------------------------------------------------------------------------

describe("matchScore exact", () => {
  test("returns 100", () => {
    expect(matchScore("Novo Nordisk", "Novo Nordisk")).toBe(100);
    expect(matchScore("NOVO NORDISK", "Novo Nordisk")).toBe(100);
    expect(matchScore("Mærsk", "Mærsk A/S")).toBe(100);
    expect(matchScore("Arla Foods", "Arla Foods A.M.B.A.")).toBe(100);
  });
});

describe("matchScore substring", () => {
  test("query contained in entry gives high score", () => {
    expect(matchScore("Carlsberg", "Carlsberg Danmark A/S")).toBeGreaterThanOrEqual(80);
  });
  test("entry contained in query gives high score", () => {
    expect(matchScore("Carlsberg Danmark", "Carlsberg")).toBeGreaterThanOrEqual(80);
  });
});

describe("matchScore short query", () => {
  test("no word overlap returns zero", () => {
    expect(matchScore("ab", "Something Unrelated Company")).toBe(0);
  });
  test("with word overlap scores", () => {
    expect(matchScore("IBM", "IBM Corporation")).toBeGreaterThan(0);
  });
});

describe("matchScore anglicize", () => {
  test("oe variant matches o with slash", () => {
    expect(matchScore("Maersk", "Mærsk A/S")).toBeGreaterThan(0);
  });
  test("aa variant", () => {
    expect(matchScore("Aarsleff", "Aarsleff")).toBe(100);
  });
});

describe("matchScore no overlap", () => {
  test("unrelated names return zero", () => {
    expect(matchScore("Apple", "Vestas Wind Systems")).toBe(0);
  });
  test("empty query/entry return zero", () => {
    expect(matchScore("", "Novo Nordisk")).toBe(0);
    expect(matchScore("Novo Nordisk", "")).toBe(0);
  });
});

describe("matchScore misc", () => {
  test("scores", () => {
    expect(matchScore("Novo Nordisk", "Novo Nordisk")).toBe(100);
    expect(matchScore("novo nordisk", "Novo Nordisk A/S")).toBe(100);
    expect(matchScore("Novo", "Novo Nordisk A/S")).toBeGreaterThan(80);
    expect(matchScore("Novo Nordisk", "Novo")).toBe(75);
    expect(matchScore("Orsted", "Ørsted A/S")).toBe(85);
    expect(matchScore("Novo Tech", "Novo Nordisk Tech A/S")).toBeGreaterThan(30);
    expect(matchScore("Google", "Microsoft")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// searchCompany
// ---------------------------------------------------------------------------

const makeData = (...entries: CompanyEntry[]): SalaryData => ({ companies: entries });
const entry = (company: string, city = ""): CompanyEntry => ({ company, city });

describe("searchCompany", () => {
  const data: SalaryData = {
    companies: [
      { company: "Novo Nordisk A/S", city: "Bagsværd" },
      { company: "Ørsted", city: "Fredericia" },
      { company: "Vestas Wind Systems", city: "Aarhus" },
    ],
  };

  test("search by name", () => {
    const results = searchCompany(data, "Novo");
    expect(results.length).toBe(1);
    expect(results[0]!.company).toBe("Novo Nordisk A/S");
  });

  test("search with city filter", () => {
    expect(searchCompany(data, "Ørsted", "Fredericia").length).toBe(1);
    expect(searchCompany(data, "Ørsted", "Bagsværd").length).toBe(0);
  });

  test("none city does not crash", () => {
    const data2 = { companies: [{ company: "Acme", city: null }] };
    expect(searchCompany(data2 as SalaryData, "Acme", "Aarhus")).toEqual([]);
  });

  test("no match returns empty list", () => {
    expect(searchCompany(makeData(entry("Vestas Wind Systems", "Aarhus")), "Apple")).toEqual([]);
  });

  test("multiple candidates all returned", () => {
    const results = searchCompany(
      makeData(
        entry("Carlsberg A/S", "Copenhagen"),
        entry("Carlsberg Danmark", "Fredericia"),
        entry("Unrelated Corp", "Odense"),
      ),
      "Carlsberg",
    );
    const companies = results.map((r) => r.company);
    expect(companies).toContain("Carlsberg A/S");
    expect(companies).toContain("Carlsberg Danmark");
    expect(companies).not.toContain("Unrelated Corp");
  });

  test("city filter: matching included, non-matching excluded, none returns all", () => {
    const data3 = makeData(entry("Novo Nordisk", "Bagsværd"), entry("Novo Nordisk", "Aarhus"));
    expect(searchCompany(data3, "Novo Nordisk", "Aarhus").length).toBe(1);
    expect(searchCompany(data3, "Novo Nordisk", "Odense")).toEqual([]);
    expect(searchCompany(data3, "Novo Nordisk").length).toBe(2);
  });

  test("city filter case-insensitive and anglicized", () => {
    const data4 = makeData(entry("Novo Nordisk", "København"));
    expect(searchCompany(data4, "Novo Nordisk", "københavn").length).toBe(1);
    expect(searchCompany(data4, "Novo Nordisk", "kobenhavn").length).toBe(1);
  });

  test("low-score matches excluded", () => {
    expect(searchCompany(makeData(entry("Novo Nordisk", "Bagsværd")), "xyz")).toEqual([]);
  });

  test("results sorted by relevance descending", () => {
    const results = searchCompany(
      makeData(entry("Novo Nordisk International", "Bagsværd"), entry("Novo Nordisk", "Bagsværd")),
      "Novo Nordisk",
    );
    expect(results[0]!.company).toBe("Novo Nordisk");
  });
});

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------

describe("utilities", () => {
  test("normalize strips suffix and noise", () => {
    expect(normalize("Novo Nordisk A/S")).toBe("novonordisk");
    expect(normalize("Ørsted (VG) Holding")).toBe("ørsted");
    expect(normalize("Chr. Hansen, Denmark Division")).toBe("chrhansen");
    expect(normalize("Simple Corp ApS")).toBe("simplecorp");
  });

  test("normalize strips dotted amba suffix same as undotted", () => {
    expect(normalize("Arla Foods A.M.B.A.")).toBe(normalize("Arla Foods amba"));
    expect(normalize("Arla Foods A.M.B.A.")).toBe("arlafoods");
  });

  test("anglicize replaces danish chars", () => {
    expect(anglicize("ørsted")).toBe("orsted");
    expect(anglicize("mærsk")).toBe("maersk");
    expect(anglicize("ålborg")).toBe("aalborg");
  });

  test("extractCoreWords", () => {
    expect(extractCoreWords("Novo Nordisk A/S")).toEqual(["novo", "nordisk"]);
    expect(extractCoreWords("A/S")).toEqual([]);
    expect(extractCoreWords("Test Company (Sub-entity)")).toEqual(["test", "company"]);
  });
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

describe("collectValidationIssues", () => {
  test("valid minimal data", () => {
    const data = { metadata: {}, companies: [{ company: "Example Corp" }] };
    expect(collectValidationIssues(data)).toEqual({ errors: [], warnings: [] });
  });

  test("top level must be object", () => {
    expect(collectValidationIssues([]).errors[0]).toBe("top-level JSON value must be an object");
  });

  test("companies must be list", () => {
    expect(
      collectValidationIssues({ companies: { company: "Example Corp" } }).errors[0],
    ).toBe("'companies' must be a list");
  });

  test("metadata must be object when provided", () => {
    expect(
      collectValidationIssues({ metadata: [], companies: [{ company: "Example Corp" }] })
        .errors[0],
    ).toBe("'metadata' must be an object when provided");
  });

  test("company entry must be object", () => {
    expect(
      collectValidationIssues({ companies: ["Example Corp"] }).errors[0],
    ).toBe("companies[1] must be an object");
  });

  test("company name is required", () => {
    expect(
      collectValidationIssues({ companies: [{ city: "Aarhus" }] }).errors[0],
    ).toBe("companies[1].company must be a non-empty string");
  });

  test("company name must not be blank", () => {
    expect(
      collectValidationIssues({ companies: [{ company: "  " }] }).errors[0],
    ).toBe("companies[1].company must be a non-empty string");
  });

  test("city must be string when provided", () => {
    expect(
      collectValidationIssues({ companies: [{ company: "Example Corp", city: 123 }] }).errors[0],
    ).toBe("companies[1].city must be a string when provided");
  });

  test("categories must be object when provided", () => {
    expect(
      collectValidationIssues({ companies: [{ company: "Example Corp", categories: [] }] })
        .errors[0],
    ).toBe("companies[1].categories must be an object when provided");
  });

  test("malformed category value rejected", () => {
    const data = { companies: [{ company: "Acme", categories: { eng: "not_a_dict" } }] };
    expect(collectValidationIssues(data).errors[0]).toContain(
      "must be an object with 'count' and/or 'index'",
    );
  });

  test("non-numeric count rejected", () => {
    const data = {
      companies: [{ company: "Acme", categories: { eng: { count: "many" } } }],
    };
    expect(collectValidationIssues(data).errors[0]).toContain("count must be a number");
  });

  test("duplicate company name is warning", () => {
    const data = {
      companies: [{ company: "Acme" }, { company: "Other Corp" }, { company: "Acme" }],
    };
    const { errors, warnings } = collectValidationIssues(data);
    expect(errors).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("Duplicate company name 'Acme'");
  });

  test("valid categories have no issues", () => {
    const data = {
      companies: [{ company: "Acme", categories: { eng: { count: 5, index: 108.5 } } }],
    };
    expect(collectValidationIssues(data)).toEqual({ errors: [], warnings: [] });
  });
});

// ---------------------------------------------------------------------------
// CLI end-to-end against temp data files
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "salary-lookup-"));
});

function writeData(payload: string): string {
  const f = join(tmp, "salary_data.json");
  writeFileSync(f, payload, "utf8");
  return f;
}

function runMain(payload: string, ...argv: string[]): { code: number; out: string; err: string } {
  const dataFile = writeData(payload);
  const lines: string[] = [];
  const errLines: string[] = [];
  const origLog = console.log;
  const origErr = process.stderr.write.bind(process.stderr);
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  (process.stderr.write as unknown) = (s: string) => {
    errLines.push(s);
    return true;
  };
  let code: number;
  try {
    code = salaryLookupMain(argv, tmp, dataFile);
  } finally {
    console.log = origLog;
    (process.stderr.write as unknown) = origErr;
  }
  return { code, out: lines.join("\n"), err: errLines.join("\n") };
}

describe("validate flag", () => {
  test("exits 1 on errors", () => {
    const r = runMain(
      '{"companies": [{"company": "Acme", "categories": {"eng": "not_a_dict"}}]}',
      "--validate",
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("must be an object with 'count' and/or 'index'");
  });

  test("exits 0 on clean", () => {
    const r = runMain(
      '{"companies": [{"company": "Acme", "categories": {"eng": {"count": 5}}}]}',
      "--validate",
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK");
  });

  test("exits 0 on duplicates only", () => {
    const r = runMain('{"companies": [{"company": "Acme"}, {"company": "Acme"}]}', "--validate");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Duplicate company name");
  });
});

describe("null shapes end-to-end", () => {
  test("null categories passes validate then renders", () => {
    const payload =
      '{"metadata": {"index_label": "Index", "index_baseline": 100},' +
      ' "companies": [{"company": "Foo A/S", "city": "Aarhus",' +
      ' "categories": null,' +
      ' "engineering": {"count": 10, "index": 105}}]}';
    let r = runMain(payload, "--validate");
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK");

    r = runMain(payload, "Foo");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Foo A/S");
    expect(r.out).toMatch(/Engineering\s+10\s+105/);
  });

  test("null metadata passes validate then renders", () => {
    const payload =
      '{"metadata": null,' +
      ' "companies": [{"company": "Foo A/S", "city": "Aarhus",' +
      ' "categories": {"engineering": {"count": 10, "index": 105}}}]}';
    let r = runMain(payload, "--validate");
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK");

    r = runMain(payload, "Foo");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Engineering\s+10\s+105/);
  });
});

describe("json parse errors", () => {
  test("reported without traceback", () => {
    const r = runMain('{"companies": [', "Foo");
    expect(r.code).toBe(1);
    expect(r.err).toContain("invalid JSON at line");
    expect(r.err).toContain("tools/README_SALARY_TOOL.md");
  });
});

describe("validateData error path", () => {
  test("exits with helpful message", () => {
    expect(() => validateData([])).toThrow();
    expect(() => validateData({ companies: { company: "x" } })).toThrow();
  });
});

describe("lookup output", () => {
  test("list-all prints companies", () => {
    const r = runMain(
      '{"companies": [{"company": "Acme", "city": "Aarhus"}, {"company": "Beta"}]}',
      "--list-all",
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain("Acme (Aarhus)");
    expect(r.out).toContain("Beta");
  });

  test("no results exits 1", () => {
    const r = runMain('{"companies": [{"company": "Acme"}]}', "Nothing");
    expect(r.code).toBe(1);
    expect(r.out).toContain("No results found for 'Nothing'");
  });

  test("no company argument prints help and exits 1", () => {
    const r = runMain('{"companies": []}');
    expect(r.code).toBe(1);
    expect(r.out).toContain("usage");
  });

  test("json output", () => {
    const r = runMain('{"companies": [{"company": "Acme"}]}', "Acme", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual([{ company: "Acme" }]);
  });
});
