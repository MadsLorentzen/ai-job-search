#!/usr/bin/env python3
"""Measure a compiled CV or cover letter's page layout, instead of eyeballing it.

The compile-and-inspect loop in `05-cv-templates.md` and the verification checklist in
CLAUDE.md already require the layout properties below. Nothing executes them: they are
checked by looking at the rendered page, which is exactly how they get missed. Each
failure below produces a clean compile, a correct page count, and a PDF that passes
`tools/verify_pdf.py`:

  orphaned entry      A moderncv \\cventry renders as a tabular, so a job entry is one
                      unbreakable block. When it does not fit, the whole entry moves to
                      the next page - or its header lands at the bottom of one page with
                      the bullets resuming on the next. CLAUDE.md calls this "the most
                      common failure".
  internal hole       The space an ejected entry leaves behind. Observed in the wild at
                      273pt, roughly 19 blank lines, mid-page, on a document whose page
                      count was correct and whose visual read looked fine.
  page ends early     A non-final page that stops well short of the bottom.
  final page thin     A last page mostly empty, which reads as an unfinished document.
  footer collision    Body text pushed into the page-number band, the usual result of
                      rescuing a page with \\enlargethispage or a negative \\vspace.

Page count is deliberately NOT checked here: `tools/verify_pdf.py --pages` already does
that, and CI runs it. Two implementations of one rule drift.

Geometry comes from Poppler word bounding boxes (`pdftotext -bbox`), the same dependency
`verify_pdf.py` already relies on. Line height serves as a font-size proxy to spot
section headings; left edge (xMin) separates bullet lines from entry headers.

Usage:
    python tools/verify_layout.py cv/main_acme_ml_engineer.pdf
    python tools/verify_layout.py cover_letters/cover_acme_ml_engineer.pdf

Exit codes: 0 clean, 1 layout problem, 2 bad invocation or Poppler missing.

Tests live in tests/test_verify_layout.py and run against synthetic pages, so the
suite needs neither Poppler nor a compiled PDF.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# A gap larger than this between consecutive lines is a hole, not spacing. Section
# spacing in the stock templates runs to roughly 45pt; 100pt is about seven lines.
GAP_LIMIT_PT = 100.0

# Bottom whitespace on a page that is not the last one. The stock geometry leaves ~85pt.
BOTTOM_LIMIT_FRACTION = 0.25

# A final page emptier than this reads as an unfinished document.
LAST_PAGE_THIN_FRACTION = 0.35

# The page-number footer lives in the bottom margin and is a text line like any other to
# Poppler. Ignore this band when measuring the body, or every page looks like it has a
# hole above its footer.
FOOTER_BAND_PT = 90.0

# A line indented at least this far past the page's left edge is a bullet or a
# continuation, not an entry header or a section heading.
INDENT_PT = 8.0

# A line this much taller than the body median is a section heading.
HEADING_HEIGHT_RATIO = 1.25

PAGE_RE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', re.S)
WORD_RE = re.compile(
    r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)</word>'
)


@dataclass
class Line:
    top: float
    bottom: float
    left: float
    height: float
    text: str


class Page:
    def __init__(self, height: float, lines: list[Line]):
        self.height = height
        self.lines = sorted(lines, key=lambda l: l.top)

    @property
    def body(self) -> list[Line]:
        cutoff = self.height - FOOTER_BAND_PT
        return [l for l in self.lines if l.top < cutoff]

    @property
    def empty(self) -> bool:
        return not self.body

    @property
    def bottom_space(self) -> float:
        return self.height - max(l.bottom for l in self.body) if self.body else self.height

    @property
    def left_edge(self) -> float:
        return min(l.left for l in self.body) if self.body else 0.0

    @property
    def body_median_height(self) -> float:
        heights = sorted(l.height for l in self.body)
        return heights[len(heights) // 2] if heights else 0.0

    @property
    def footer_crowded(self) -> bool:
        """One line in the bottom band is a page number; two means body text spilled in."""
        band = self.height - FOOTER_BAND_PT
        return len({round(l.top, 1) for l in self.lines if l.top >= band}) > 1

    def is_indented(self, line: Line) -> bool:
        return line.left > self.left_edge + INDENT_PT

    def is_heading(self, line: Line) -> bool:
        median = self.body_median_height
        return bool(median) and line.height > median * HEADING_HEIGHT_RATIO

    def largest_gap(self) -> tuple[float, float]:
        tops = sorted({round(l.top, 1) for l in self.body})
        if len(tops) < 2:
            return (0.0, 0.0)
        return max((tops[i + 1] - tops[i], tops[i]) for i in range(len(tops) - 1))


def parse_pdf(path: Path) -> list[Page]:
    if not shutil.which("pdftotext"):
        raise RuntimeError("pdftotext (Poppler) not found; install poppler-utils")
    out = subprocess.run(
        ["pdftotext", "-bbox", "-enc", "UTF-8", str(path), "-"],
        capture_output=True, text=True, check=True,
    ).stdout
    pages = []
    for _w, h, body in PAGE_RE.findall(out):
        buckets: dict[float, list[tuple[float, float, float, str]]] = {}
        for x_min, y_min, y_max, text in WORD_RE.findall(body):
            key = round(float(y_min), 0)  # words on one line share a rounded yMin
            buckets.setdefault(key, []).append((float(x_min), float(y_min), float(y_max), text))
        lines = [
            Line(
                top=min(w[1] for w in words),
                bottom=max(w[2] for w in words),
                left=min(w[0] for w in words),
                height=max(w[2] - w[1] for w in words),
                text=" ".join(w[3] for w in sorted(words)),
            )
            for words in buckets.values()
        ]
        pages.append(Page(float(h), lines))
    return pages


def find_orphans(pages: list[Page]) -> list[str]:
    """A page ending on an entry header or section heading whose content resumes overleaf.

    Two shapes, both documented failures:
      * the last body line of a page is a section heading (stranded heading)
      * the last body lines are un-indented (an entry header) while the next page opens
        with indented bullet lines, i.e. the entry was split across the break
    """
    problems = []
    # Indentation must be judged against the document's left margin, not each page's own
    # minimum: a page that *opens* with indented bullets would otherwise treat their
    # indent as its margin and report nothing.
    body_lines = [l for p in pages for l in p.body]
    if not body_lines:
        return problems
    doc_left = min(l.left for l in body_lines)

    def indented(line: Line) -> bool:
        return line.left > doc_left + INDENT_PT

    for i in range(len(pages) - 1):
        here, nxt = pages[i], pages[i + 1]
        if here.empty or nxt.empty:
            continue
        last, first = here.body[-1], nxt.body[0]

        if here.is_heading(last):
            problems.append(
                f"p{i + 1} ends on the section heading {last.text.strip()!r} with its content "
                f"on p{i + 2}. Shorten the entry that follows it, or let the heading and its "
                "first entry move to the next page together"
            )
        elif not indented(last) and indented(first):
            # moderncv puts an itemize marker in its own bbox line at the list's left
            # edge, so a list item split across the break looks like an un-indented
            # header followed by indented text. Different defect, different fix.
            if not re.search(r"\w", last.text):
                problems.append(
                    f"p{i + 1} ends on a lone list marker whose text continues on p{i + 2} "
                    f"({first.text.strip()[:60]!r}): a bullet is split across the page break. "
                    "Shorten the preceding content so the whole item fits on one page"
                )
            else:
                problems.append(
                    f"p{i + 1} ends on the un-indented line {last.text.strip()[:60]!r} while "
                    f"p{i + 2} opens with the indented line {first.text.strip()[:60]!r}: an entry "
                    "header is orphaned from its bullets. Add \\needspace before that "
                    "\\cventry, or shorten it"
                )
    return problems


def report(path: Path, pages: list[Page]) -> list[str]:
    problems: list[str] = []
    print(f"{path}: {len(pages)} page(s) (page count is verify_pdf.py's job, not checked here)")

    for i, page in enumerate(pages, 1):
        if page.empty:
            problems.append(f"p{i} contains no text")
            print(f"  p{i}: EMPTY")
            continue

        gap, gap_y = page.largest_gap()
        share = page.bottom_space / page.height
        print(
            f"  p{i}: text y {page.body[0].top:.0f}..{page.body[-1].bottom:.0f}"
            f" of {page.height:.0f}pt | bottom {page.bottom_space:.0f}pt ({share * 100:.0f}%)"
            f" | largest gap {gap:.0f}pt at y{gap_y:.0f}"
        )

        if gap > GAP_LIMIT_PT:
            problems.append(
                f"p{i} has a {gap:.0f}pt hole at y{gap_y:.0f} (~{gap / 14:.0f} blank lines). "
                "A moderncv \\cventry is an unbreakable tabular: shorten the entry that "
                "follows the hole so it fits, or move a shorter section above it"
            )
        if i < len(pages) and share > BOTTOM_LIMIT_FRACTION:
            problems.append(
                f"p{i} ends {page.bottom_space:.0f}pt ({share * 100:.0f}%) early although "
                "more pages follow, which reads as a broken page break"
            )
        if page.footer_crowded:
            problems.append(
                f"p{i} has body text inside the bottom margin band, colliding with the "
                "footer; stop stretching the page with \\enlargethispage and cut content"
            )
        if i == len(pages) > 1 and share > LAST_PAGE_THIN_FRACTION:
            problems.append(
                f"p{i} is the last page and {share * 100:.0f}% empty, which reads as an "
                "unfinished document; restore the highest-relevance content previously cut"
            )

    problems.extend(find_orphans(pages))
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", nargs="?", type=Path)
    args = ap.parse_args()

    if not args.pdf:
        ap.error("pdf is required")
    if not args.pdf.exists():
        print(f"error: {args.pdf} not found", file=sys.stderr)
        return 2

    try:
        pages = parse_pdf(args.pdf)
    except RuntimeError as exc:
        print(f"skipped: {exc}", file=sys.stderr)
        return 2

    problems = report(args.pdf, pages)
    if problems:
        print("\nLAYOUT PROBLEMS:")
        for m in problems:
            print(f"  - {m}")
        return 1
    print("layout: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
