#!/usr/bin/env python3
"""Render an HTML resume/cover letter to PDF with headless Chromium.

Used instead of LaTeX for the ATS one-page format: it reproduces the approved
Word-style layout exactly, and Chromium's PDF text layer extracts cleanly for
ATS parsers.

    python3 tools/build_resume.py cv/main_acme_coordinator.html

Writes the PDF beside the HTML, then reports page count and flags a resume that
is not exactly one page.
"""
import argparse
import glob
import os
import shutil
import subprocess
import sys
import tempfile

CHROME_CANDIDATES = [
    "/opt/pw-browsers/chromium-*/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
]


def find_chrome():
    for pattern in CHROME_CANDIDATES:
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[-1]
    for name in ("chromium", "chromium-browser", "google-chrome"):
        path = shutil.which(name)
        if path:
            return path
    sys.exit("No Chromium found. Set PLAYWRIGHT_BROWSERS_PATH or install chromium.")


def page_count(pdf):
    if not shutil.which("pdfinfo"):
        return None
    out = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("-o", "--output")
    ap.add_argument("--expect-pages", type=int, default=1)
    args = ap.parse_args()

    html = os.path.abspath(args.html)
    if not os.path.exists(html):
        sys.exit(f"No such file: {html}")
    pdf = os.path.abspath(args.output or os.path.splitext(html)[0] + ".pdf")

    with tempfile.TemporaryDirectory() as profile:
        cmd = [
            find_chrome(),
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            f"--user-data-dir={profile}",
            "--no-pdf-header-footer",
            f"--print-to-pdf={pdf}",
            f"file://{html}",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
    if not os.path.exists(pdf):
        sys.exit(f"Chromium produced no PDF.\n{res.stderr[-2000:]}")

    pages = page_count(pdf)
    print(f"wrote {pdf}" + (f" ({pages} page{'s' if pages != 1 else ''})" if pages else ""))
    if pages is not None and pages != args.expect_pages:
        print(
            f"FAIL: expected {args.expect_pages} page(s), got {pages}. "
            "Trim content, or add class=\"tight\" to <body>.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
