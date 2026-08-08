"""Rapport HTML autonome, sans service distant ni ressource externe."""

from __future__ import annotations

from collections import Counter
from html import escape
from pathlib import Path
from typing import Any

from .opportunities import load_opportunities
from .storage import read_csv_rows, write_text_atomic


def render_html_report(tracker_path: Path, opportunities_path: Path | None, output: Path) -> str:
    tracker = read_csv_rows(tracker_path) if tracker_path.exists() else []
    opportunities = load_opportunities(opportunities_path) if opportunities_path and opportunities_path.exists() else []
    statuses = Counter(row.get("status") or "inconnu" for row in tracker)
    zones = Counter(row.get("location") or "inconnue" for row in tracker)
    rows = []
    for row in tracker:
        rows.append("<tr>" + "".join(f"<td>{escape(str(row.get(key) or ''))}</td>" for key in ("company", "role", "location", "status", "next_action_at", "source_url")) + "</tr>")
    status_html = "".join(f"<li>{escape(str(key))}: {value}</li>" for key, value in statuses.items()) or "<li>Aucune candidature</li>"
    zone_html = "".join(f"<li>{escape(str(key))}: {value}</li>" for key, value in zones.items()) or "<li>Aucune zone</li>"
    html = f"""<!doctype html><html lang='fr'><head><meta charset='utf-8'><title>Rapport ai-job-search-fr</title><style>body{{font:15px system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#172033}}.cards{{display:flex;gap:1rem;flex-wrap:wrap}}.card{{border:1px solid #ccd6e0;border-radius:8px;padding:1rem;min-width:10rem}}table{{border-collapse:collapse;width:100%;margin-top:1rem}}th,td{{border:1px solid #ccd6e0;padding:.45rem;text-align:left}}th{{background:#edf3f8}}input{{padding:.5rem;width:100%;max-width:28rem}}</style></head><body><h1>Recherche d'emploi</h1><div class='cards'><div class='card'><strong>{len(tracker)}</strong><br>candidatures</div><div class='card'><strong>{len(opportunities)}</strong><br>opportunités</div><div class='card'><strong>{statuses.get('entretien', 0)}</strong><br>entretiens</div></div><h2>Statuts</h2><ul>{status_html}</ul><h2>Zones</h2><ul>{zone_html}</ul><h2>Pipeline</h2><label>Filtrer <input id='filter' oninput='filterRows()' aria-label='Filtrer le pipeline'></label><table id='pipeline'><thead><tr><th>Entreprise</th><th>Rôle</th><th>Zone</th><th>Statut</th><th>Prochaine action</th><th>Source</th></tr></thead><tbody>{''.join(rows)}</tbody></table><script>function filterRows(){{const q=document.getElementById('filter').value.toLowerCase();document.querySelectorAll('#pipeline tbody tr').forEach(r=>r.style.display=r.innerText.toLowerCase().includes(q)?'':'none')}};</script></body></html>"""
    write_text_atomic(output, html)
    return html

