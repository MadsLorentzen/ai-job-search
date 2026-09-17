"""Renders resume/cover-letter HTML (Jinja2 templates) to PDF via Playwright's
`page.pdf()` -- reusing the one browser-automation dependency the plan already
requires for application automation, instead of adding a second PDF library.
"""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from playwright.sync_api import sync_playwright

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
DATA_DIR = Path(__file__).resolve().parents[2] / "data"

_env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), autoescape=select_autoescape(["html"]))


def render_html(template_name: str, context: dict) -> str:
    return _env.get_template(template_name).render(**context)


def html_to_pdf(html: str, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # A fresh browser launch per render costs ~1-2s; fine for the current
    # on-demand "tailor this one job" flow. Revisit with a shared/reused
    # browser instance if the Phase 5 scheduler ends up rendering in bulk.
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html, wait_until="load")
        page.pdf(path=str(output_path), format="Letter", print_background=True)
        browser.close()


def resume_paths(job_id: int) -> tuple[Path, Path]:
    base = DATA_DIR / "resumes"
    return base / f"{job_id}.html", base / f"{job_id}.pdf"


def cover_letter_paths(job_id: int) -> tuple[Path, Path]:
    base = DATA_DIR / "cover_letters"
    return base / f"{job_id}.html", base / f"{job_id}.pdf"
