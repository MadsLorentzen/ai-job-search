/**
 * Verify that a generated PDF has the expected pages and extractable text.
 *
 * Port of tools/verify_pdf.py. The Python original preferred pypdf and fell
 * back to Poppler; this port uses Poppler (`pdftotext`/`pdfinfo`) directly,
 * which was the Python fallback path and the only path CI ever guaranteed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class VerificationError extends Error {}

export type Runner = (command: string[]) => string;

/** Run an external command, capturing stdout; VerificationError on failure. */
export function runTool(command: string[]): string {
  const res = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error || res.status === null) {
    throw new VerificationError(
      `required command '${command[0]}' was not found. ` +
        "Install poppler-utils (macOS: brew install poppler, " +
        "Debian/Ubuntu: apt install poppler-utils, Windows: choco install poppler)",
    );
  }
  if (res.status !== 0) {
    const detail = (res.stderr || "").trim() || (res.stdout || "").trim() || "command failed";
    throw new VerificationError(`${command[0]} could not read the PDF: ${detail}`);
  }
  return res.stdout ?? "";
}

export function parsePageCount(pdfinfoOutput: string): number {
  const match = pdfinfoOutput.match(/^Pages:\s+(\d+)\s*$/m);
  if (!match) {
    throw new VerificationError("pdfinfo output did not contain a page count");
  }
  return Number(match[1]);
}

export function normalizeText(text: string): string {
  return text.split(/\s+/).join(" ").trim();
}

export interface TextLayer {
  text: string;
  pages: number;
  extractor: string;
}

/** Extract ATS-readable text via Poppler. */
export function extractTextLayer(pdfPath: string, run: Runner = runTool): TextLayer {
  const text = run(["pdftotext", "-layout", "-enc", "UTF-8", pdfPath, "-"]);
  // Always call pdfinfo so the page count comes back even when the caller
  // did not request --pages (same Poppler package).
  const pages = parsePageCount(run(["pdfinfo", pdfPath]));
  return { text, pages, extractor: "pdftotext" };
}

export interface VerifyOptions {
  expectedPages?: number;
  minChars?: number;
  requiredText?: string[];
  dumpText?: string;
  run?: Runner;
}

export function verifyPdf(pdfPath: string, opts: VerifyOptions = {}): TextLayer {
  if (!existsSync(pdfPath)) {
    throw new VerificationError(`PDF does not exist: ${pdfPath}`);
  }
  const { expectedPages, minChars = 1, requiredText = [], dumpText } = opts;
  const { text: extractedText, pages: actualPages, extractor } = extractTextLayer(
    pdfPath,
    opts.run,
  );

  // Write dump *before* the checks so a failed verification still leaves a .txt
  if (dumpText !== undefined) {
    try {
      mkdirSync(dirname(dumpText), { recursive: true });
      writeFileSync(dumpText, extractedText.endsWith("\n") ? extractedText : extractedText + "\n");
    } catch (exc) {
      throw new VerificationError(`could not write --dump-text to ${dumpText}: ${exc}`);
    }
  }

  if (expectedPages !== undefined && actualPages !== expectedPages) {
    throw new VerificationError(
      `expected ${expectedPages} page(s), found ${actualPages} (extractor: ${extractor})`,
    );
  }

  const normalized = normalizeText(extractedText);
  if (normalized.length < minChars) {
    throw new VerificationError(
      `text layer has ${normalized.length} character(s); expected at least ${minChars} ` +
        `(extractor: ${extractor})`,
    );
  }

  for (const required of requiredText) {
    if (!normalized.includes(normalizeText(required))) {
      throw new VerificationError(
        `text layer is missing required text: '${required}' (extractor: ${extractor})`,
      );
    }
  }
  return { text: extractedText, pages: actualPages, extractor };
}

export function verifyPdfMain(argv: string[]): number {
  const flags: Record<string, string | string[]> = {};
  const positional: string[] = [];
  const push = (k: string, v: string) => {
    if (k in flags && Array.isArray(flags[k])) (flags[k] as string[]).push(v);
    else flags[k] = [v];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pages" || a === "--min-chars" || a === "--dump-text") {
      push(a.slice(2).replace(/-/g, ""), argv[++i]);
    } else if (a === "--contains") {
      push("contains", argv[++i]);
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: cli.ts verify-pdf <pdf> [--pages N] [--min-chars N] [--contains TEXT]... [--dump-text PATH]\n",
      );
      return 0;
    } else if (a.startsWith("-")) {
      process.stderr.write(`Error: unrecognized argument: ${a}\n`);
      return 2;
    } else {
      positional.push(a);
    }
  }
  const pdf = positional[0];
  if (!pdf) {
    process.stderr.write("usage: cli.ts verify-pdf <pdf> [--pages N] [--min-chars N] ...\n");
    return 2;
  }
  const contains = Array.isArray(flags.contains) ? (flags.contains as string[]) : [];
  try {
    const { extractor, pages } = verifyPdf(pdf, {
      expectedPages: flags.pages !== undefined ? Number(flags.pages) : undefined,
      minChars: flags.minchars !== undefined ? Number(flags.minchars) : 1,
      requiredText: contains,
      dumpText: flags.dumptext as string | undefined,
    });
    process.stdout.write(`Verified ${pdf} (extractor: ${extractor}, pages: ${pages})\n`);
    return 0;
  } catch (exc) {
    if (exc instanceof VerificationError) {
      process.stderr.write(`Error: ${pdf}: ${exc.message}\n`);
      return 1;
    }
    throw exc;
  }
}
