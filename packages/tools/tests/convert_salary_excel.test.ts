/** Tests for convert_salary_excel — header detection, pairing, parsing. */
import { describe, expect, test } from "bun:test";
import {
  INDEX_PATTERNS,
  detectColumnType,
  headerMatches,
  parseNumericCell,
  parseSheet,
  type Worksheet,
} from "../src/convert_salary_excel.ts";

type Cell = string | number | null;

function ws(rows: Cell[][]): Worksheet {
  return { title: "Sheet1", rows };
}

describe("detectColumnType", () => {
  test("index headers are not misclassified as count", () => {
    for (const header of ["Index", "Salary Index", "Engineering Index", "Median salary"]) {
      expect(detectColumnType(header)).toBe("index");
    }
  });

  test("single letter n only matches as a token", () => {
    expect(detectColumnType("Employee n")).toBe("count");
    expect(detectColumnType("Engineering")).toBeNull();
  });

  test("count headers still match common labels", () => {
    for (const header of ["Count", "Engineering Count", "Antal medarbejdere"]) {
      expect(detectColumnType(header)).toBe("count");
    }
  });

  test("count inside word does not make count header", () => {
    expect(detectColumnType("Accounting Total")).toBeNull();
    expect(detectColumnType("Accounting Index")).toBe("index");
  });

  test("danish compound headers still match", () => {
    expect(detectColumnType("Lønindeks")).toBe("index");
  });

  test("compound patterns match as substring but others do not", () => {
    expect(headerMatches("lønindeks", INDEX_PATTERNS)).toBe(true);
    expect(headerMatches("salaryindex", INDEX_PATTERNS)).toBe(false);
    expect(headerMatches("salary index", INDEX_PATTERNS)).toBe(true);
  });
});

describe("parseNumericCell", () => {
  test("numbers pass through", () => {
    expect(parseNumericCell(12)).toBe(12);
    expect(parseNumericCell(105.5)).toBe(105.5);
  });

  test("comma decimal string values", () => {
    expect(parseNumericCell("12,0")).toBe(12);
    expect(parseNumericCell("108,5")).toBe(108.5);
  });

  test("us locale value", () => {
    expect(parseNumericCell("1,234.56")).toBe(1234.56);
  });

  test("european locale value", () => {
    expect(parseNumericCell("1.234,56")).toBe(1234.56);
  });

  test("non-numeric throws", () => {
    expect(() => parseNumericCell("good")).toThrow();
    expect(() => parseNumericCell(null)).toThrow();
  });
});

describe("parseSheet", () => {
  test("preserves category name with letter n", () => {
    const companies = parseSheet(ws([
      ["Company", "Engineering Count", "Engineering Index"],
      ["Example Corp", 12, 105.5],
    ]));
    expect(companies[0]!.categories["engineering"]).toEqual({ count: 12, index: 105.5 });
  });

  test("groups accounting count/index pair", () => {
    const companies = parseSheet(ws([
      ["Company", "Accounting Count", "Accounting Index"],
      ["Example Corp", 12, 105.5],
    ]));
    expect(companies[0]!.categories["accounting"]).toEqual({ count: 12, index: 105.5 });
  });

  test("normalizes paired category name with underscores", () => {
    const companies = parseSheet(ws([
      ["Company", "Software Engineering Count", "Software Engineering Index"],
      ["Example Corp", 8, 110.0],
    ]));
    expect(companies[0]!.categories["software_engineering"]).toEqual({ count: 8, index: 110 });
  });

  test("detects company column with token header", () => {
    for (const header of ["Company", "Company Name", "Employer Name"]) {
      const companies = parseSheet(ws([
        [header, "Salary"],
        ["Example Corp", 105.5],
      ]));
      expect(companies.length).toBe(1);
      expect(companies[0]!.company).toBe("Example Corp");
      expect(companies[0]!.categories["salary"]).toEqual({ index: 105.5 });
    }
  });

  test("detects city column with token header", () => {
    for (const header of ["City", "City Name", "Kommune", "City/Kommune"]) {
      const companies = parseSheet(ws([
        ["Company", header, "Salary"],
        ["Example Corp", "Aarhus", 105.5],
      ]));
      expect(companies.length).toBe(1);
      expect(companies[0]!.city).toBe("Aarhus");
    }
  });

  test("handles ragged rows", () => {
    const companies = parseSheet(ws([
      ["Company", "City", "Engineering Count", "Engineering Index"],
      ["Example Corp"],
      ["Other Corp", "Aarhus", 12, 105.5],
    ]));
    expect(companies.length).toBe(2);
    expect(companies[0]!.company).toBe("Example Corp");
    expect(companies[0]!.city).toBe("");
    expect(companies[0]!.categories).toEqual({});
    expect(companies[1]!.categories["engineering"]).toEqual({ count: 12, index: 105.5 });
  });

  test("skips row shorter than company column", () => {
    const companies = parseSheet(ws([
      ["Notes", "Company", "Salary Index"],
      ["stray"],
      ["", "Example Corp", 105.5],
    ]));
    expect(companies.length).toBe(1);
    expect(companies[0]!.company).toBe("Example Corp");
  });

  test("skips free-text column", () => {
    const companies = parseSheet(ws([
      ["Company", "Salary Index", "Notes"],
      ["Example Corp", 105.5, "good"],
    ]));
    expect("salary_index" in companies[0]!.categories).toBe(true);
    expect("notes" in companies[0]!.categories).toBe(false);
  });

  test("skips numeric identifier column", () => {
    const companies = parseSheet(ws([
      ["Company", "Salary Index", "Id"],
      ["Example Corp", 105.5, 7],
    ]));
    expect("salary_index" in companies[0]!.categories).toBe(true);
    expect("id" in companies[0]!.categories).toBe(false);
  });

  test("keeps numeric salary column", () => {
    const companies = parseSheet(ws([
      ["Company", "Salary Index"],
      ["Example Corp", 105.5],
    ]));
    expect(companies[0]!.categories["salary_index"]).toEqual({ index: 105.5 });
  });

  test("accepts comma decimal string values", () => {
    const companies = parseSheet(ws([
      ["Company", "Engineering Count", "Engineering Index"],
      ["Example Corp", "12,0", "108,5"],
    ]));
    expect(companies[0]!.categories["engineering"]).toEqual({ count: 12, index: 108.5 });
  });

  test("danish firma headers pair compound categories", () => {
    const companies = parseSheet(ws([
      ["Firma", "Antal alle", "Lønindeks alle"],
      ["Example Corp", 12, 118.0],
    ]));
    expect(companies[0]!.categories["alle"]).toEqual({ count: 12, index: 118 });
  });

  test("sheet-level us locale value", () => {
    const companies = parseSheet(ws([
      ["Company", "Salary Index"],
      ["Example Corp", "1,234.56"],
    ]));
    expect(companies[0]!.categories["salary_index"]).toEqual({ index: 1234.56 });
  });

  test("missing header row returns empty", () => {
    const companies = parseSheet(ws([
      ["nothing", "here"],
      ["no", "company column"],
    ]));
    expect(companies).toEqual([]);
  });

  test("standalone count column tagged as count", () => {
    const companies = parseSheet(ws([
      ["Company", "Employees"],
      ["Example Corp", 42],
    ]));
    expect(companies[0]!.categories["employees"]).toEqual({ count: 42 });
  });
});
