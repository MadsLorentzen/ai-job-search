"""Self-contained HTML tracker rendering without LLM involvement."""

import csv
import html
from pathlib import Path
from typing import Iterable


def render_tracker_html(rows: Iterable[dict], generated_date: str) -> str:
    rows = list(rows)
    table_rows = []
    for row in rows:
        cells = [
            html.escape(str(row.get(field, "") or ""))
            for field in ("date", "company", "role", "sector", "status")
        ]
        table_rows.append("<tr>" + "".join(f"<td>{cell}</td>" for cell in cells) + "</tr>")
    return (
        "<!doctype html><html><head><meta charset='utf-8'><title>Job Search Dashboard</title>"
        "<style>body{font-family:system-ui,sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}"
        "td,th{border:1px solid #ddd;padding:.5rem;text-align:left}th{background:#222;color:#fff}</style></head>"
        f"<body><h1>Job Search Dashboard</h1><p>Generated: {html.escape(generated_date)}</p>"
        "<table><thead><tr><th>Date</th><th>Company</th><th>Role</th><th>Sector</th><th>Status</th></tr></thead>"
        f"<tbody>{''.join(table_rows)}</tbody></table></body></html>"
    )


def render_tracker_file(input_csv: Path, output_html: Path, generated_date: str) -> None:
    with input_csv.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    output_html.parent.mkdir(parents=True, exist_ok=True)
    output_html.write_text(render_tracker_html(rows, generated_date), encoding="utf-8")