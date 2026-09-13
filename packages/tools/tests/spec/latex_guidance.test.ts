/** Guards for the LaTeX authoring guidance and example documents. Port of
 * tests/test_latex_guidance.py (skills under .pi-agent/skills). */
import { describe, expect, test } from "bun:test";
import { REPO, SKILLS, WORKFLOWS, read } from "./helpers.ts";

const CV_TEMPLATES = `${SKILLS}/job-application-assistant/05-cv-templates.md`;
const COVER_TEMPLATES = `${SKILLS}/job-application-assistant/06-cover-letter-templates.md`;
const APPLY = `${WORKFLOWS}/apply.md`;
const EXAMPLE_CV = `${REPO}/cv/main_example.tex`;
const EXAMPLE_COVER = `${REPO}/cover_letters/cover_example.tex`;

const UNBRACED_BRACKET_ITEM = /\\item\s*\[/;
const REQUIRED_ESCAPES = ["\\&", "\\%", "\\$", "\\#", "\\_"];

function section(text: string, heading: string): string | null {
  const pattern = new RegExp(
    `^#+ ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\n([\\s\\S]*?)(?=^#+ |(?![\\s\\S]))`,
    "m",
  );
  return pattern.exec(text)?.[1] ?? null;
}

describe("bullet bracket trap", () => {
  function assertNoUnbracedBracketItems(path: string): void {
    const offending = read(path)
      .split("\n")
      .map((line, i) => ({ line, lineno: i + 1 }))
      .filter(({ line }) => UNBRACED_BRACKET_ITEM.test(line))
      .map(({ lineno, line }) => `${lineno}: ${line.trim()}`);
    expect(offending).toEqual([]);
  }

  test("example cv has no bracket-labelled bullets", () => assertNoUnbracedBracketItems(EXAMPLE_CV));
  test("example cover letter has none", () => assertNoUnbracedBracketItems(EXAMPLE_COVER));
  test("cover letter guide does not teach the broken pattern", () =>
    assertNoUnbracedBracketItems(COVER_TEMPLATES));
  test("cv guide does not teach the broken pattern", () =>
    assertNoUnbracedBracketItems(CV_TEMPLATES));
});

describe("special character guidance", () => {
  function assertEscapesDocumented(path: string): void {
    const body = section(read(path), "LaTeX Special Characters");
    expect(body).not.toBeNull();
    const missing = REQUIRED_ESCAPES.filter((esc) => !body!.includes(esc));
    expect(missing).toEqual([]);
  }

  test("cv guide documents the escapes", () => assertEscapesDocumented(CV_TEMPLATES));
  test("cover letter guide documents the escapes", () => assertEscapesDocumented(COVER_TEMPLATES));

  test("cv guide warns that percent truncates silently", () => {
    const body = section(read(CV_TEMPLATES), "LaTeX Special Characters");
    expect(body).not.toBeNull();
    expect(body!.toLowerCase()).toContain("silent");
  });
});

describe("ats extraction encoding", () => {
  function assertPdftotextPinsUtf8(path: string): void {
    const offending = read(path)
      .split("\n")
      .map((line, i) => ({ line, lineno: i + 1 }))
      .filter(
        ({ line }) =>
          line.includes("pdftotext") && line.includes("-layout") && !line.includes("-enc UTF-8"),
      )
      .map(({ lineno, line }) => `${lineno}: ${line.trim()}`);
    expect(offending).toEqual([]);
  }

  test("apply extraction command pins utf8", () => assertPdftotextPinsUtf8(APPLY));
  test("cv guide extraction command pins utf8", () => assertPdftotextPinsUtf8(CV_TEMPLATES));
});
