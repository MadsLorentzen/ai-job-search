/** Port of tests/test_verify_pdf.py (pypdf-preference cases dropped: poppler-only port). */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  VerificationError,
  parsePageCount,
  runTool,
  verifyPdf,
  type Runner,
} from "../src/verify_pdf.ts";

describe("parsePageCount", () => {
  test("parses pdfinfo page count", () => {
    expect(parsePageCount("Title: Example\nPages:          2\n")).toBe(2);
  });
  test("rejects output without a page count", () => {
    expect(() => parsePageCount("Title: Example\n")).toThrow(VerificationError);
    expect(() => parsePageCount("Title: Example\n")).toThrow("did not contain a page count");
  });
});

function fakePdf(): string {
  const dir = mkdtempSync(join(tmpdir(), "verify-pdf-"));
  const pdf = join(dir, "example.pdf");
  writeFileSync(pdf, "%PDF-1.4\n");
  return pdf;
}

describe("verifyPdf", () => {
  test("accepts expected pages and text", () => {
    const outs = ["Professional\nExperience   [your.email@example.com]\n", "Pages:          2\n"];
    const run: Runner = () => outs.shift()!;
    verifyPdf(fakePdf(), {
      expectedPages: 2,
      minChars: 20,
      requiredText: ["Professional Experience", "[your.email@example.com]"],
      run,
    });
  });

  test("rejects wrong page count", () => {
    const run: Runner = () => "Pages:          3\n";
    expect(() => verifyPdf(fakePdf(), { expectedPages: 2, run })).toThrow(
      /expected 2 page.*found 3/,
    );
  });

  test("rejects too little extractable text", () => {
    const run: Runner = () => "Pages:          1\n";
    expect(() => verifyPdf(fakePdf(), { minChars: 20, run })).toThrow("expected at least 20");
  });

  test("rejects missing required text", () => {
    const outs = ["Readable text, but not the expected section.\n", "Pages:          1\n"];
    const run: Runner = () => outs.shift()!;
    expect(() => verifyPdf(fakePdf(), { requiredText: ["Professional Experience"], run })).toThrow(
      "Professional Experience",
    );
  });

  test("rejects a missing pdf", () => {
    expect(() => verifyPdf(join(tmpdir(), "verify-pdf-missing", "missing.pdf"))).toThrow(
      "PDF does not exist",
    );
  });
});

describe("runTool", () => {
  test("reports a missing poppler command", () => {
    expect(() => runTool(["definitely-not-a-real-command-xyz", "example.pdf", "-"])).toThrow(
      "Install poppler",
    );
  });

  test("reports an unreadable pdf", () => {
    expect(() =>
      runTool(["bash", "-c", "echo 'invalid PDF' >&2; exit 1"]),
    ).toThrow("invalid PDF");
  });
});
