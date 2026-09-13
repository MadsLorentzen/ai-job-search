/**
 * Measure a compiled CV or cover letter's page layout, instead of eyeballing it.
 *
 * Port of tools/verify_layout.py. Geometry comes from Poppler word bounding
 * boxes (`pdftotext -bbox`); there is no pypdf equivalent, so this step
 * requires Poppler. Without it (or with an extractor that cannot do -bbox),
 * the check reports `skipped:` and exits 2 rather than inventing a layout
 * failure.
 *
 * Exit codes: 0 clean, 1 layout problem, 2 bad invocation or no usable extractor.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// A gap larger than this between consecutive lines is a hole, not spacing.
export const GAP_LIMIT_PT = 100.0;
// Bottom whitespace on a page that is not the last one.
export const BOTTOM_LIMIT_FRACTION = 0.25;
// A final page emptier than this reads as an unfinished document.
export const LAST_PAGE_THIN_FRACTION = 0.35;
// The page-number footer band, ignored when measuring the body.
export const FOOTER_BAND_PT = 90.0;
// A line indented at least this far past the left edge is a bullet/continuation.
export const INDENT_PT = 8.0;
// A line this much taller than the body median is a section heading.
export const HEADING_HEIGHT_RATIO = 1.25;

export interface Line {
  top: number;
  bottom: number;
  left: number;
  height: number;
  text: string;
}

export interface Page {
  height: number;
  lines: Line[]; // sorted by top
}

export function makePage(height: number, lines: Line[]): Page {
  return { height, lines: [...lines].sort((a, b) => a.top - b.top) };
}

export function pageBody(page: Page): Line[] {
  const cutoff = page.height - FOOTER_BAND_PT;
  return page.lines.filter((l) => l.top < cutoff);
}

export function pageEmpty(page: Page): boolean {
  return pageBody(page).length === 0;
}

export function bottomSpace(page: Page): number {
  const body = pageBody(page);
  return body.length ? page.height - Math.max(...body.map((l) => l.bottom)) : page.height;
}

export function leftEdge(page: Page): number {
  const body = pageBody(page);
  return body.length ? Math.min(...body.map((l) => l.left)) : 0.0;
}

export function bodyMedianHeight(page: Page): number {
  const heights = pageBody(page).map((l) => l.height).sort((a, b) => a - b);
  return heights.length ? heights[Math.floor(heights.length / 2)] : 0.0;
}

/** One line in the bottom band is a page number; two means body text spilled in. */
export function footerCrowded(page: Page): boolean {
  const band = page.height - FOOTER_BAND_PT;
  const tops = new Set(page.lines.filter((l) => l.top >= band).map((l) => Number(l.top.toFixed(1))));
  return tops.size > 1;
}

export function isIndented(page: Page, line: Line): boolean {
  return line.left > leftEdge(page) + INDENT_PT;
}

export function isHeading(page: Page, line: Line): boolean {
  const median = bodyMedianHeight(page);
  return median > 0 && line.height > median * HEADING_HEIGHT_RATIO;
}

/** Largest top-to-top distance between body lines, and where it starts. */
export function largestGap(page: Page): [number, number] {
  const tops = [...new Set(pageBody(page).map((l) => Number(l.top.toFixed(1))))].sort((a, b) => a - b);
  if (tops.length < 2) return [0.0, 0.0];
  let best: [number, number] = [0.0, tops[0]];
  for (let i = 0; i < tops.length - 1; i++) {
    const gap = tops[i + 1] - tops[i];
    if (gap > best[0]) best = [gap, tops[i]];
  }
  return best;
}

const PAGE_RE = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
const WORD_RE =
  /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g;

/** Parse `pdftotext -bbox` XML output into pages of lines. */
export function parseBboxPages(out: string): Page[] {
  const pages: Page[] = [];
  for (const [, , h, body] of out.matchAll(PAGE_RE)) {
    const buckets = new Map<number, [number, number, number, string][]>();
    for (const [, xMin, yMin, yMax, text] of body.matchAll(WORD_RE)) {
      const key = Math.round(Number(yMin)); // words on one line share a rounded yMin
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push([Number(xMin), Number(yMin), Number(yMax), text]);
    }
    const lines: Line[] = [...buckets.values()].map((words) => ({
      top: Math.min(...words.map((w) => w[1])),
      bottom: Math.max(...words.map((w) => w[2])),
      left: Math.min(...words.map((w) => w[0])),
      height: Math.max(...words.map((w) => w[2] - w[1])),
      text: words.map((w) => w[3]).join(" "),
    }));
    pages.push(makePage(Number(h), lines));
  }
  return pages;
}

export interface ExtractorDeps {
  which?: (cmd: string) => string | null;
  run?: (cmd: string[]) => { status: number; stdout: string; stderr: string };
}

/** Run pdftotext -bbox and parse the geometry. Throws a skippable Error. */
export function parsePdf(path: string, deps: ExtractorDeps = {}): Page[] {
  const which = deps.which ?? ((cmd: string) => {
    const res = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
    return res.status === 0 ? (res.stdout || "").trim() : null;
  });
  const run =
    deps.run ??
    ((cmd: string[]) => {
      const res = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
    });

  if (!which("pdftotext")) {
    throw new Error("pdftotext (Poppler) not found; install poppler-utils");
  }
  const res = run(["pdftotext", "-bbox", "-enc", "UTF-8", path, "-"]);
  if (res.status !== 0) {
    // An xpdf-based pdftotext has no -bbox and exits 99. That is a broken
    // extractor, not a broken document: degrade to the skip path.
    const stderrLines = res.stderr.trim().split("\n");
    const detail = stderrLines[0] || `exit ${res.status}`;
    throw new Error(
      `pdftotext could not produce bounding boxes for ${path} (${detail}); ` +
        "a pdftotext without -bbox is usually the xpdf build that Git for Windows " +
        "puts ahead of Poppler in PATH",
    );
  }
  return parseBboxPages(res.stdout);
}

export function findOrphans(pages: Page[]): string[] {
  const problems: string[] = [];
  // Indentation is judged against the document's left margin, not each page's
  // own minimum: a page that *opens* with indented bullets would otherwise
  // treat their indent as its margin and report nothing.
  const bodyLines = pages.flatMap((p) => pageBody(p));
  if (bodyLines.length === 0) return problems;
  const docLeft = Math.min(...bodyLines.map((l) => l.left));
  const indented = (line: Line) => line.left > docLeft + INDENT_PT;

  for (let i = 0; i < pages.length - 1; i++) {
    const here = pages[i];
    const nxt = pages[i + 1];
    if (pageEmpty(here) || pageEmpty(nxt)) continue;
    const last = pageBody(here).at(-1)!;
    const first = pageBody(nxt)[0];

    if (isHeading(here, last)) {
      problems.push(
        `p${i + 1} ends on the section heading '${last.text.trim()}' with its content ` +
          `on p${i + 2}. Shorten the entry that follows it, or let the heading and its ` +
          "first entry move to the next page together",
      );
    } else if (!indented(last) && indented(first)) {
      // moderncv puts an itemize marker in its own bbox line at the list's left
      // edge, so a list item split across the break looks like an un-indented
      // header followed by indented text. Different defect, different fix.
      if (!/\w/.test(last.text)) {
        problems.push(
          `p${i + 1} ends on a lone list marker whose text continues on p${i + 2} ` +
            `('${first.text.trim().slice(0, 60)}'): a bullet is split across the page break. ` +
            "Shorten the preceding content so the whole item fits on one page",
        );
      } else {
        problems.push(
          `p${i + 1} ends on the un-indented line '${last.text.trim().slice(0, 60)}' while ` +
            `p${i + 2} opens with the indented line '${first.text.trim().slice(0, 60)}': an entry ` +
          "header is orphaned from its bullets. Add \\needspace before that " +
            "\\cventry, or shorten it",
        );
      }
    }
  }
  return problems;
}

export function report(path: string, pages: Page[]): string[] {
  const problems: string[] = [];
  process.stdout.write(`${path}: ${pages.length} page(s) (page count is verify_pdf's job, not checked here)\n`);

  pages.forEach((page, idx) => {
    const i = idx + 1;
    if (pageEmpty(page)) {
      problems.push(`p${i} contains no text`);
      process.stdout.write(`  p${i}: EMPTY\n`);
      return;
    }
    const body = pageBody(page);
    const [gap, gapY] = largestGap(page);
    const share = bottomSpace(page) / page.height;
    process.stdout.write(
      `  p${i}: text y ${body[0].top.toFixed(0)}..${body.at(-1)!.bottom.toFixed(0)}` +
        ` of ${page.height.toFixed(0)}pt | bottom ${bottomSpace(page).toFixed(0)}pt (${(share * 100).toFixed(0)}%)` +
        ` | largest gap ${gap.toFixed(0)}pt at y${gapY.toFixed(0)}\n`,
    );

    if (gap > GAP_LIMIT_PT) {
      problems.push(
        `p${i} has a ${gap.toFixed(0)}pt hole at y${gapY.toFixed(0)} (~${(gap / 14).toFixed(0)} blank lines). ` +
          "A moderncv \\cventry is an unbreakable tabular: shorten the entry that " +
          "follows the hole so it fits, or move a shorter section above it",
      );
    }
    if (i < pages.length && share > BOTTOM_LIMIT_FRACTION) {
      problems.push(
        `p${i} ends ${bottomSpace(page).toFixed(0)}pt (${(share * 100).toFixed(0)}%) early although ` +
          "more pages follow, which reads as a broken page break",
      );
    }
    if (footerCrowded(page)) {
      problems.push(
        `p${i} has body text inside the bottom margin band, colliding with the ` +
          "footer; stop stretching the page with \\enlargethispage and cut content",
      );
    }
    if (i === pages.length && pages.length > 1 && share > LAST_PAGE_THIN_FRACTION) {
      problems.push(
        `p${i} is the last page and ${(share * 100).toFixed(0)}% empty, which reads as an ` +
          "unfinished document; restore the highest-relevance content previously cut",
      );
    }
  });

  problems.push(...findOrphans(pages));
  return problems;
}

export function verifyLayoutMain(argv: string[], deps: ExtractorDeps = {}): number {
  const pdf = argv.find((a) => !a.startsWith("-"));
  if (!pdf) {
    process.stderr.write("usage: cli.ts verify-layout <pdf>\n");
    return 2;
  }
  if (!existsSync(pdf)) {
    process.stderr.write(`error: ${pdf} not found\n`);
    return 2;
  }
  let pages: Page[];
  try {
    pages = parsePdf(pdf, deps);
  } catch (exc) {
    process.stderr.write(`skipped: ${(exc as Error).message}\n`);
    return 2;
  }
  const problems = report(pdf, pages);
  if (problems.length) {
    process.stdout.write("\nLAYOUT PROBLEMS:\n");
    for (const m of problems) process.stdout.write(`  - ${m}\n`);
    return 1;
  }
  process.stdout.write("layout: clean\n");
  return 0;
}
