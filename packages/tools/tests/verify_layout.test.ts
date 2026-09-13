/** Offline tests for verify_layout — synthetic Page/Line geometry, no Poppler. */
import { describe, expect, test } from "bun:test";
import {
  makePage,
  bottomSpace,
  pageEmpty,
  footerCrowded,
  isHeading,
  isIndented,
  pageBody,
  largestGap,
  findOrphans,
  report,
  verifyLayoutMain,
  type Line,
  type Page,
} from "../src/verify_layout.ts";

const A4_HEIGHT = 842.0;

function line(top: number, left = 50.0, height = 10.0, text = "x"): Line {
  return { top, bottom: top + height, left, height, text };
}

describe("gap and bottom space", () => {
  // Three body lines, then a 322pt jump, then the page-number footer.
  const holed: Page = makePage(A4_HEIGHT, [
    line(50),
    line(64),
    line(78),
    line(400),
    line(770, 50.0, 10, "1/2"),
  ]);

  test("largest gap reports size and position", () => {
    const [gap, y] = largestGap(holed);
    expect([Math.round(gap), Math.round(y)]).toEqual([322, 78]);
  });

  test("bottom space ignores the footer band", () => {
    expect(Math.round(bottomSpace(holed))).toBe(432);
  });

  test("page with no body lines is empty", () => {
    expect(pageEmpty(makePage(A4_HEIGHT, []))).toBe(true);
  });

  test("report flags the hole", () => {
    const problems = report("synthetic", [holed]);
    expect(problems.some((m) => m.includes("hole"))).toBe(true);
  });
});

describe("footer band", () => {
  test("single line in band is just the page number", () => {
    expect(
      footerCrowded(makePage(A4_HEIGHT, [line(50), line(800, 50.0, 10, "2/2")])),
    ).toBe(false);
  });

  test("two lines in band means body text spilled in", () => {
    expect(
      footerCrowded(makePage(A4_HEIGHT, [line(50), line(780), line(800)])),
    ).toBe(true);
  });
});

describe("heading and indent detection", () => {
  const page = makePage(A4_HEIGHT, [
    line(50, 50.0, 16.0, "Professional Experience"),
    line(80),
    line(94, 70.0),
  ]);
  const body = pageBody(page);

  test("taller line is a heading", () => {
    expect(isHeading(page, body[0])).toBe(true);
    expect(isHeading(page, body[1])).toBe(false);
  });

  test("left edge separates bullets from headers", () => {
    expect(isIndented(page, body[2])).toBe(true);
    expect(isIndented(page, body[1])).toBe(false);
  });
});

describe("orphans", () => {
  test("page ending on a section heading", () => {
    const p1 = makePage(A4_HEIGHT, [line(50), line(64), line(700, 50.0, 16.0, "Education")]);
    const p2 = makePage(A4_HEIGHT, [line(60, 50.0, 10, "Example University"), line(74, 70.0)]);
    expect(findOrphans([p1, p2]).some((m) => m.includes("ends on the section heading"))).toBe(
      true,
    );
  });

  test("entry header orphaned from its bullets", () => {
    const q1 = makePage(A4_HEIGHT, [line(50), line(700, 50.0, 10, "Software Engineer")]);
    const q2 = makePage(A4_HEIGHT, [line(60, 70.0, 10, "- built the thing")]);
    expect(findOrphans([q1, q2]).some((m) => m.includes("orphaned from its bullets"))).toBe(
      true,
    );
  });

  test("lone list marker is a split bullet, not an orphaned header", () => {
    const m1 = makePage(A4_HEIGHT, [line(50), line(700, 50.0, 10, "●")]);
    const m2 = makePage(A4_HEIGHT, [line(60, 70.0, 10, "continued item text here")]);
    expect(findOrphans([m1, m2]).some((m) => m.includes("lone list marker"))).toBe(true);
  });

  test("clean break reports nothing", () => {
    const r1 = makePage(A4_HEIGHT, [line(50), line(700)]);
    const r2 = makePage(A4_HEIGHT, [line(60)]);
    expect(findOrphans([r1, r2])).toEqual([]);
  });

  test("indent is judged against the document margin", () => {
    const s1 = makePage(A4_HEIGHT, [line(50, 50.0, 10, "x"), line(700, 50.0, 10, "Data Analyst")]);
    const s2 = makePage(A4_HEIGHT, [line(60, 70.0, 10, "- first bullet")]);
    expect(findOrphans([s1, s2]).some((m) => m.includes("orphaned from its bullets"))).toBe(
      true,
    );
  });
});

describe("extractor failure", () => {
  // A broken extractor must not masquerade as a broken document: exit 2 (skip),
  // never 1 ("your document is broken").

  test("extractor failure exits 2 not 1", () => {
    const code = verifyLayoutMain(["factory/main_example.pdf"], {
      which: () => "/usr/bin/pdftotext",
      run: () => ({ status: 99, stdout: "", stderr: "Error: unknown flag" }),
    });
    expect(code).toBe(2);
  });

  test("missing pdf exits 2 on usage", () => {
    expect(verifyLayoutMain([])).toBe(2);
  });
});
