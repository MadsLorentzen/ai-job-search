#!/usr/bin/env bun
// Regenerates job_scraper/dashboard.html — a self-contained, bookmarkable local
// dashboard reading job_scraper/seen_jobs.json + job_search_tracker.csv. Run by
// /scrape and /rank (end of Step 4) alongside export_csv.js so the dashboard never
// drifts far out of sync with the underlying data — see those skills for the call site.
//
// The generated HTML embeds a full snapshot of the data at generation time (a file://
// page can't reliably fetch() sibling files across browsers), so it is a point-in-time
// view, not a live feed. Bookmark the output file directly; re-run this script (or
// /scrape / /rank, which call it automatically) to refresh what it shows. It is
// read-only by design — status changes belong in the tracker via /apply and /outcome,
// never edited in the browser, since any in-page edit would be silently lost on the
// next regeneration.

const JSON_PATH = new URL("./seen_jobs.json", import.meta.url)
const TRACKER_PATH = new URL("../job_search_tracker.csv", import.meta.url)
const CLAUDE_MD_PATH = new URL("../CLAUDE.md", import.meta.url)
const OUT_PATH = new URL("./dashboard.html", import.meta.url)

/**
 * Minimal RFC4180-ish CSV line parser — only what's needed to read back the tracker's
 * own csvEscape-style quoting (quotes doubled, fields with commas/newlines wrapped).
 * No external dependency, matching this repo's zero-dependency tooling convention.
 * Duplicated from export_csv.js rather than shared, so each export script stays a
 * single self-contained file (same convention as the portal-search CLIs).
 */
function parseCsvLine(line) {
  const fields = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
      fields.push(cur)
      cur = ""
    } else {
      cur += c
    }
  }
  fields.push(cur)
  return fields
}

/**
 * German-market postings routinely carry a gender-marker suffix - (m/w/d), (m/f/d),
 * (w/m/d), (f/m/d), and their asterisk/slash variants - that the scraped title keeps
 * but a tracker row written by hand or trimmed during /apply may drop (or vice versa).
 * Stripping it before matching avoids false "Not applied" negatives on an otherwise
 * identical role/company pair. Same rule as export_csv.js.
 */
function normalizeRole(role) {
  return role
    .replace(/[\s([]*[mwfd]\s*[/*]\s*[mwfd]\s*(?:[/*]\s*[mwfd]\s*)?\)?\s*$/i, "")
    .trim()
}

function inferMarket(locationText) {
  if (!locationText) return null
  const t = locationText.toLowerCase()
  if (t.includes("germany") || t.includes("deutschland")) return "DE"
  if (t.includes("uk") || t.includes("united kingdom") || t.includes("england") || t.includes("scotland")) return "UK"
  return null
}

async function readVisaDeadline() {
  try {
    const text = await Bun.file(CLAUDE_MD_PATH).text()
    const match = text.match(/visa expires\s+([A-Za-z]+ \d{4})/i)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Unlike export_csv.js's readTrackerStatus (which only needs a status string), the
 * dashboard's detail panel wants the full tracker row - date, fit_rating, notes,
 * cv_file, cover_letter_file, channel, contact_person - so this returns parsed rows
 * keyed by normalized company|role, last-match-wins (a re-application overwrites the
 * earlier row, which is the more current state to show).
 */
async function readTrackerRows() {
  const byKey = new Map()
  let text
  try {
    text = await Bun.file(TRACKER_PATH).text()
  } catch {
    return byKey
  }
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length < 2) return byKey
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  if (idx.company === undefined || idx.role === undefined) return byKey
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line)
    const company = (f[idx.company] ?? "").trim()
    const role = (f[idx.role] ?? "").trim()
    if (!company || !role) continue
    const key = `${company.toLowerCase()}|${normalizeRole(role.toLowerCase())}`
    byKey.set(key, {
      date: f[idx.date] ?? "",
      sector: f[idx.sector] ?? "",
      role_type: f[idx.role_type] ?? "",
      channel: f[idx.channel] ?? "",
      status: (f[idx.status] ?? "").trim(),
      contact_person: f[idx.contact_person] ?? "",
      fit_rating: f[idx.fit_rating] ?? "",
      notes: f[idx.notes] ?? "",
      cv_file: f[idx.cv_file] ?? "",
      cover_letter_file: f[idx.cover_letter_file] ?? "",
      source: f[idx.source] ?? "",
    })
  }
  return byKey
}

function findTrackerRow(entry, trackerByKey) {
  const key = `${(entry.company ?? "").trim().toLowerCase()}|${normalizeRole((entry.title ?? "").trim().toLowerCase())}`
  return trackerByKey.get(key) ?? null
}

/** Relative-to-dashboard.html link for a tracker file path like "cv/main_x.tex", preferring the compiled PDF sibling since that's what a human actually wants to open. */
function toDashboardLink(path) {
  if (!path) return null
  const pdf = path.replace(/\.tex$/i, ".pdf")
  return `../${pdf}`
}

/**
 * Mirrors export_csv.js's visaFlagStatus but only for the one case that needs a
 * human-readable note in the dashboard's detail panel: a UK posting flagged for
 * sponsorship verification. Germany/PASS/FAIL cases are already fully conveyed by
 * the Location badge, so this stays a single targeted note rather than a full column.
 */
function visaNote(entry, market, visaDeadline) {
  if (market !== "UK" || entry.location !== "FLAG") return null
  const deadline = visaDeadline ? `your visa expires ${visaDeadline}` : "check your own visa timeline"
  return `Verify this employer holds an active UK sponsor licence — ${deadline}.`
}

function buildJobs(seen, trackerByKey, visaDeadline) {
  return Object.entries(seen).map(([key, entry]) => {
    const tracker = findTrackerRow(entry, trackerByKey)
    const market = inferMarket(entry.location_text)
    return {
      key,
      title: entry.title ?? null,
      company: entry.company ?? null,
      url: entry.url ?? null,
      first_seen: entry.first_seen ?? null,
      status: entry.status ?? null,
      portal: entry.portal ?? null,
      location_text: entry.location_text ?? null,
      market,
      rank_score: typeof entry.rank_score === "number" ? entry.rank_score : null,
      rank_verdict: entry.rank_verdict ?? null,
      rank_date: entry.rank_date ?? null,
      location_gate: entry.location ?? null,
      language_gate: entry.language_gate ?? null,
      language_note: entry.language_note ?? null,
      visa_note: visaNote(entry, market, visaDeadline),
      strengths: Array.isArray(entry.strengths) ? entry.strengths : [],
      gaps: Array.isArray(entry.gaps) ? entry.gaps : [],
      application: tracker
        ? {
            status: tracker.status || null,
            date: tracker.date || null,
            fit_rating: tracker.fit_rating || null,
            notes: tracker.notes || null,
            channel: tracker.channel || null,
            contact_person: tracker.contact_person || null,
            cv_link: toDashboardLink(tracker.cv_file),
            cover_letter_link: toDashboardLink(tracker.cover_letter_file),
          }
        : null,
    }
  })
}

function computeStats(jobs) {
  const isVetoed = (j) => j.location_gate === "FAIL" || j.language_gate === "FAIL"
  const isShortlisted = (j) =>
    j.rank_verdict && ["Strong Fit", "Good Fit"].includes(j.rank_verdict) && !isVetoed(j)
  const appStatus = (j) => (j.application?.status ?? "").toLowerCase()
  const stageCount = (pred) => jobs.filter(pred).length

  return {
    total: jobs.length,
    ranked: stageCount((j) => !!j.rank_verdict),
    shortlisted: stageCount(isShortlisted),
    excluded: stageCount(isVetoed),
    drafted: stageCount((j) => appStatus(j) === "drafted"),
    applied: stageCount((j) => appStatus(j) === "applied"),
    interview: stageCount((j) => appStatus(j).includes("interview")),
    offer: stageCount((j) => appStatus(j).includes("offer") || appStatus(j) === "hired"),
    rejected: stageCount((j) => appStatus(j).includes("reject")),
  }
}

function escapeForScriptTag(jsonString) {
  // Prevents a literal "</script>" inside any scraped title/note from prematurely
  // closing the embedded data block - safe because < is a valid JSON string escape.
  return jsonString.replace(/</g, "\\u003c")
}

const PAGE_TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Search Dashboard</title>
<style>
:root {
  --bg: #f6f7fb; --panel: #ffffff; --text: #1a1f2b; --muted: #667085; --border: #e3e6ee;
  --accent: #2f5fe0; --green: #12805c; --green-bg: #e3f7ee; --blue: #2f5fe0; --blue-bg: #e8edfc;
  --amber: #92620a; --amber-bg: #fdf1d8; --red: #b3261e; --red-bg: #fbe7e6; --gray: #667085; --gray-bg: #eef0f4;
  --purple: #6b3fd4; --purple-bg: #efe8fc; --teal: #0f7a72; --teal-bg: #e2f5f3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12141c; --panel: #1a1d29; --text: #e7e9f0; --muted: #9aa1b5; --border: #2a2e3d;
    --accent: #7c9bff; --green: #4fd8a3; --green-bg: #113228; --blue: #7c9bff; --blue-bg: #1c2542;
    --amber: #f0b94d; --amber-bg: #3a2c0f; --red: #ff8a80; --red-bg: #3a1a18; --gray: #9aa1b5; --gray-bg: #23273a;
    --purple: #b79aff; --purple-bg: #2a2049; --teal: #6fe0d3; --teal-bg: #10312e;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.4;
}
header { padding: 20px 24px 8px; }
header h1 { margin: 0 0 4px; font-size: 22px; }
header .meta { color: var(--muted); font-size: 13px; }
main { padding: 0 24px 40px; max-width: 1400px; margin: 0 auto; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 16px 0 20px; }
.stat-card {
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
  cursor: pointer; transition: border-color .15s;
}
.stat-card:hover { border-color: var(--accent); }
.stat-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.stat-card .num { font-size: 24px; font-weight: 700; }
.stat-card .label { font-size: 12px; color: var(--muted); margin-top: 2px; }

.controls {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px;
}
.controls input[type="search"], .controls select {
  background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 7px;
  padding: 7px 10px; font-size: 13px;
}
.controls input[type="search"] { flex: 1 1 220px; min-width: 160px; }
.controls select { flex: 0 0 auto; }
.controls button {
  background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 7px;
  padding: 7px 12px; font-size: 13px; cursor: pointer;
}
.controls button:hover { border-color: var(--accent); }
.result-count { font-size: 12px; color: var(--muted); margin-left: auto; white-space: nowrap; }

table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
thead th {
  text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted);
  padding: 10px 12px; border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; white-space: nowrap;
  position: sticky; top: 0; background: var(--panel);
}
thead th:hover { color: var(--text); }
thead th .arrow { opacity: .5; margin-left: 3px; }
tbody td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top; }
tbody tr.job-row { cursor: pointer; }
tbody tr.job-row:hover { background: var(--bg); }
tbody tr.detail-row td { background: var(--bg); }
.company { font-weight: 600; }
.role { color: var(--muted); font-size: 12px; margin-top: 1px; }

.badge {
  display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap;
}
.badge-green { background: var(--green-bg); color: var(--green); }
.badge-blue { background: var(--blue-bg); color: var(--blue); }
.badge-amber { background: var(--amber-bg); color: var(--amber); }
.badge-red { background: var(--red-bg); color: var(--red); }
.badge-gray { background: var(--gray-bg); color: var(--gray); }
.badge-purple { background: var(--purple-bg); color: var(--purple); }
.badge-teal { background: var(--teal-bg); color: var(--teal); }

.score { font-variant-numeric: tabular-nums; font-weight: 600; }
.link-icon { color: var(--accent); text-decoration: none; font-size: 14px; }
.link-icon:hover { text-decoration: underline; }

.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 6px 4px 14px; }
.detail-grid h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; color: var(--muted); letter-spacing: .03em; }
.detail-grid ul { margin: 0; padding-left: 18px; font-size: 13px; }
.detail-grid ul li { margin-bottom: 3px; }
.detail-grid .empty { color: var(--muted); font-size: 13px; font-style: italic; }
.detail-field { font-size: 13px; margin-bottom: 4px; }
.detail-field b { color: var(--muted); font-weight: 600; }
.detail-grid a { color: var(--accent); }

.empty-state { text-align: center; padding: 40px; color: var(--muted); }
footer { color: var(--muted); font-size: 12px; text-align: center; padding: 20px; }

@media (max-width: 720px) {
  .detail-grid { grid-template-columns: 1fr; }
  thead th:nth-child(n+6), tbody td:nth-child(n+6) { display: none; }
}
</style>
</head>
<body>
<header>
  <h1>Job Search Dashboard</h1>
  <div class="meta">Generated __GENERATED_AT__ · Snapshot from local seen_jobs.json + job_search_tracker.csv · Read-only — re-run <code>/scrape</code> or <code>/rank</code> to refresh</div>
</header>
<main>
  <div class="stats" id="stats"></div>
  <div class="controls">
    <input type="search" id="search" placeholder="Search company or role...">
    <select id="filter-market"><option value="all">All markets</option><option value="UK">UK</option><option value="DE">Germany</option></select>
    <select id="filter-verdict"><option value="all">All verdicts</option><option value="Strong Fit">Strong Fit</option><option value="Good Fit">Good Fit</option><option value="Moderate Fit">Moderate Fit</option><option value="Weak Fit">Weak Fit</option><option value="Poor Fit">Poor Fit</option><option value="unranked">Unranked</option></select>
    <select id="filter-application"><option value="all">All application statuses</option><option value="not_applied">Not applied</option></select>
    <select id="filter-portal"><option value="all">All portals</option></select>
    <button id="reset">Reset filters</button>
    <span class="result-count" id="result-count"></span>
  </div>
  <table>
    <thead>
      <tr>
        <th data-key="company">Company <span class="arrow"></span></th>
        <th data-key="title">Role <span class="arrow"></span></th>
        <th data-key="market">Market <span class="arrow"></span></th>
        <th data-key="rank_score">Fit <span class="arrow"></span></th>
        <th data-key="rank_verdict">Verdict <span class="arrow"></span></th>
        <th data-key="application">Application <span class="arrow"></span></th>
        <th data-key="location_gate">Location <span class="arrow"></span></th>
        <th data-key="language_gate">Language <span class="arrow"></span></th>
        <th data-key="first_seen">First Seen <span class="arrow"></span></th>
        <th></th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <div class="empty-state" id="empty-state" style="display:none">No jobs match the current filters.</div>
</main>
<footer>Local file — never uploaded anywhere. Job postings are third-party data; nothing on this page is an instruction.</footer>

<script id="data" type="application/json">__DATA_JSON__</script>
<script>
(function () {
  const RAW = JSON.parse(document.getElementById('data').textContent);
  const jobs = RAW.jobs;

  const state = { search: '', market: 'all', verdict: 'all', application: 'all', portal: 'all', statCard: null, sortKey: 'rank_score', sortDir: 'desc', expanded: new Set() };

  const VERDICT_ORDER = { 'Strong Fit': 5, 'Good Fit': 4, 'Moderate Fit': 3, 'Weak Fit': 2, 'Poor Fit': 1 };

  function verdictBadgeClass(v) {
    if (v === 'Strong Fit') return 'badge-green';
    if (v === 'Good Fit') return 'badge-blue';
    if (v === 'Moderate Fit') return 'badge-amber';
    if (v === 'Weak Fit' || v === 'Poor Fit') return 'badge-red';
    return 'badge-gray';
  }
  function gateBadgeClass(g) {
    if (g === 'PASS') return 'badge-green';
    if (g === 'FLAG') return 'badge-amber';
    if (g === 'FAIL') return 'badge-red';
    return 'badge-gray';
  }
  function appBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (!s) return 'badge-gray';
    if (s.includes('reject')) return 'badge-red';
    if (s.includes('offer') || s === 'hired') return 'badge-green';
    if (s.includes('interview')) return 'badge-teal';
    if (s === 'applied') return 'badge-purple';
    if (s === 'drafted') return 'badge-blue';
    return 'badge-gray';
  }
  function appLabel(job) {
    if (!job.application || !job.application.status) return 'Not applied';
    const s = job.application.status;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function marketLabel(m) { return m === 'UK' ? 'UK' : m === 'DE' ? 'Germany' : '—'; }

  function el(tag, opts) {
    const node = document.createElement(tag);
    if (opts) {
      if (opts.class) node.className = opts.class;
      if (opts.text !== undefined) node.textContent = opts.text;
      if (opts.html !== undefined) node.innerHTML = opts.html;
      if (opts.attrs) for (const k in opts.attrs) node.setAttribute(k, opts.attrs[k]);
    }
    return node;
  }

  function badge(text, cls) { return '<span class="badge ' + cls + '">' + text + '</span>'; }

  function populatePortalFilter() {
    const portals = Array.from(new Set(jobs.map(j => j.portal).filter(Boolean))).sort();
    const sel = document.getElementById('filter-portal');
    for (const p of portals) sel.appendChild(el('option', { text: p, attrs: { value: p } }));
  }

  // "Not applied" is always offered even with zero matches (it's the default state for
  // most rows); every other status is only added once it actually appears in the tracker,
  // so the dropdown grows on its own as the pipeline progresses (applied, interview, offer...)
  // without needing the generator script to know the full set of possible statuses up front.
  function populateApplicationFilter() {
    const statuses = Array.from(new Set(jobs.map(j => j.application && j.application.status ? j.application.status.toLowerCase() : null).filter(Boolean))).sort();
    const sel = document.getElementById('filter-application');
    for (const s of statuses) sel.appendChild(el('option', { text: s.charAt(0).toUpperCase() + s.slice(1), attrs: { value: s } }));
  }

  function applicationFilterValue(job) {
    return job.application && job.application.status ? job.application.status.toLowerCase() : 'not_applied';
  }
  function isVetoed(j) { return j.location_gate === 'FAIL' || j.language_gate === 'FAIL'; }
  function isShortlisted(j) { return j.rank_verdict && (j.rank_verdict === 'Strong Fit' || j.rank_verdict === 'Good Fit') && !isVetoed(j); }

  function matchesFilters(job) {
    if (state.search) {
      const hay = ((job.company || '') + ' ' + (job.title || '')).toLowerCase();
      if (!hay.includes(state.search.toLowerCase())) return false;
    }
    if (state.market !== 'all' && job.market !== state.market) return false;
    if (state.verdict !== 'all') {
      if (state.verdict === 'unranked') { if (job.rank_verdict) return false; }
      else if (job.rank_verdict !== state.verdict) return false;
    }
    if (state.application !== 'all' && applicationFilterValue(job) !== state.application) return false;
    if (state.portal !== 'all' && job.portal !== state.portal) return false;
    if (state.statCard === 'shortlisted' && !isShortlisted(job)) return false;
    if (state.statCard === 'excluded' && !isVetoed(job)) return false;
    if (state.statCard && ['drafted', 'applied'].includes(state.statCard) && applicationFilterValue(job) !== state.statCard) return false;
    if (state.statCard === 'interview' && !applicationFilterValue(job).includes('interview')) return false;
    if (state.statCard === 'offer' && !(applicationFilterValue(job).includes('offer') || applicationFilterValue(job) === 'hired')) return false;
    if (state.statCard === 'ranked' && !job.rank_verdict) return false;
    return true;
  }

  function sortValue(job, key) {
    if (key === 'rank_score') return job.rank_score === null ? -1 : job.rank_score;
    if (key === 'rank_verdict') return VERDICT_ORDER[job.rank_verdict] || 0;
    if (key === 'company') return (job.company || '').toLowerCase();
    if (key === 'title') return (job.title || '').toLowerCase();
    if (key === 'market') return job.market || '';
    if (key === 'application') return applicationFilterValue(job);
    if (key === 'location_gate') return job.location_gate || '';
    if (key === 'language_gate') return job.language_gate || '';
    if (key === 'first_seen') return job.first_seen || '';
    return '';
  }

  function sortJobs(list) {
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const av = sortValue(a, state.sortKey), bv = sortValue(b, state.sortKey);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function renderStats() {
    const s = RAW.stats;
    const cards = [
      { key: null, label: 'Total Jobs', num: s.total },
      { key: 'ranked', label: 'Ranked', num: s.ranked },
      { key: 'shortlisted', label: 'Shortlisted', num: s.shortlisted },
      { key: 'drafted', label: 'Drafted', num: s.drafted },
      { key: 'applied', label: 'Applied', num: s.applied },
      { key: 'interview', label: 'Interview', num: s.interview },
      { key: 'offer', label: 'Offer', num: s.offer },
      { key: 'excluded', label: 'Excluded', num: s.excluded },
    ];
    const container = document.getElementById('stats');
    container.innerHTML = '';
    for (const c of cards) {
      const card = el('div', { class: 'stat-card' + (state.statCard === c.key && c.key ? ' active' : '') });
      card.appendChild(el('div', { class: 'num', text: String(c.num) }));
      card.appendChild(el('div', { class: 'label', text: c.label }));
      card.addEventListener('click', () => {
        state.statCard = state.statCard === c.key ? null : c.key;
        render();
      });
      container.appendChild(card);
    }
  }

  function detailRow(job) {
    const tr = el('tr', { class: 'detail-row' });
    const td = el('td', { attrs: { colspan: '10' } });
    const grid = el('div', { class: 'detail-grid' });

    const left = el('div');
    left.appendChild(el('h4', { text: 'Strengths' }));
    if (job.strengths.length) {
      const ul = el('ul');
      job.strengths.forEach(s => ul.appendChild(el('li', { text: s })));
      left.appendChild(ul);
    } else left.appendChild(el('div', { class: 'empty', text: 'None recorded' }));
    left.appendChild(el('h4', { text: 'Gaps' }));
    if (job.gaps.length) {
      const ul = el('ul');
      job.gaps.forEach(s => ul.appendChild(el('li', { text: s })));
      left.appendChild(ul);
    } else left.appendChild(el('div', { class: 'empty', text: 'None recorded' }));
    if (job.language_note) {
      left.appendChild(el('h4', { text: 'Language note' }));
      left.appendChild(el('div', { class: 'detail-field', text: job.language_note }));
    }
    if (job.visa_note) {
      left.appendChild(el('h4', { text: 'Visa note' }));
      left.appendChild(el('div', { class: 'detail-field', text: job.visa_note }));
    }

    const right = el('div');
    right.appendChild(el('h4', { text: 'Details' }));
    const fields = [
      ['Location', job.location_text],
      ['Portal', job.portal],
      ['Rank date', job.rank_date],
      ['Source', null],
    ];
    for (const [label, val] of fields) {
      if (label === 'Source') {
        if (job.url) {
          const f = el('div', { class: 'detail-field' });
          f.appendChild(el('b', { text: label + ': ' }));
          const a = el('a', { text: 'Open posting', attrs: { href: job.url, target: '_blank', rel: 'noopener' } });
          f.appendChild(a);
          right.appendChild(f);
        }
        continue;
      }
      if (!val) continue;
      const f = el('div', { class: 'detail-field' });
      f.appendChild(el('b', { text: label + ': ' }));
      f.appendChild(document.createTextNode(val));
      right.appendChild(f);
    }
    right.appendChild(el('h4', { text: 'Application' }));
    if (job.application) {
      const a = job.application;
      const appFields = [['Applied/drafted', a.date], ['Channel', a.channel], ['Contact', a.contact_person], ['Notes', a.notes]];
      for (const [label, val] of appFields) {
        if (!val) continue;
        const f = el('div', { class: 'detail-field' });
        f.appendChild(el('b', { text: label + ': ' }));
        f.appendChild(document.createTextNode(val));
        right.appendChild(f);
      }
      if (a.cv_link) {
        const f = el('div', { class: 'detail-field' });
        f.appendChild(el('b', { text: 'CV: ' }));
        f.appendChild(el('a', { text: 'Open CV PDF', attrs: { href: a.cv_link, target: '_blank' } }));
        right.appendChild(f);
      }
      if (a.cover_letter_link) {
        const f = el('div', { class: 'detail-field' });
        f.appendChild(el('b', { text: 'Cover letter: ' }));
        f.appendChild(el('a', { text: 'Open cover letter PDF', attrs: { href: a.cover_letter_link, target: '_blank' } }));
        right.appendChild(f);
      }
    } else {
      right.appendChild(el('div', { class: 'empty', text: 'Not applied yet' }));
    }

    grid.appendChild(left);
    grid.appendChild(right);
    td.appendChild(grid);
    tr.appendChild(td);
    return tr;
  }

  function renderTable(list) {
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';
    document.getElementById('empty-state').style.display = list.length ? 'none' : 'block';

    for (const job of list) {
      const tr = el('tr', { class: 'job-row' });

      const tdCompany = el('td');
      tdCompany.appendChild(el('div', { class: 'company', text: job.company || '—' }));
      tr.appendChild(tdCompany);

      tr.appendChild(el('td', { text: job.title || '—' }));
      tr.appendChild(el('td', { html: badge(marketLabel(job.market), 'badge-gray') }));
      tr.appendChild(el('td', { class: 'score', text: job.rank_score !== null ? job.rank_score.toFixed(1) : '—' }));
      tr.appendChild(el('td', { html: job.rank_verdict ? badge(job.rank_verdict, verdictBadgeClass(job.rank_verdict)) : badge('Unranked', 'badge-gray') }));
      tr.appendChild(el('td', { html: badge(appLabel(job), appBadgeClass(job.application ? job.application.status : null)) }));
      tr.appendChild(el('td', { html: job.location_gate ? badge(job.location_gate, gateBadgeClass(job.location_gate)) : '—' }));
      tr.appendChild(el('td', { html: job.language_gate ? badge(job.language_gate, gateBadgeClass(job.language_gate)) : '—' }));
      tr.appendChild(el('td', { text: job.first_seen || '—' }));

      const tdLink = el('td');
      if (job.url) {
        const a = el('a', { class: 'link-icon', text: '↗', attrs: { href: job.url, target: '_blank', rel: 'noopener', title: 'Open posting' } });
        a.addEventListener('click', (e) => e.stopPropagation());
        tdLink.appendChild(a);
      }
      tr.appendChild(tdLink);

      tr.addEventListener('click', () => {
        if (state.expanded.has(job.key)) state.expanded.delete(job.key);
        else state.expanded.add(job.key);
        render();
      });
      tbody.appendChild(tr);

      if (state.expanded.has(job.key)) tbody.appendChild(detailRow(job));
    }
  }

  function updateSortArrows() {
    document.querySelectorAll('thead th[data-key]').forEach(th => {
      const arrow = th.querySelector('.arrow');
      if (th.dataset.key === state.sortKey) arrow.textContent = state.sortDir === 'asc' ? '▲' : '▼';
      else arrow.textContent = '';
    });
  }

  function render() {
    const filtered = jobs.filter(matchesFilters);
    const sorted = sortJobs(filtered);
    renderStats();
    renderTable(sorted);
    updateSortArrows();
    document.getElementById('result-count').textContent = 'Showing ' + sorted.length + ' of ' + jobs.length;
  }

  document.getElementById('search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  document.getElementById('filter-market').addEventListener('change', (e) => { state.market = e.target.value; render(); });
  document.getElementById('filter-verdict').addEventListener('change', (e) => { state.verdict = e.target.value; render(); });
  document.getElementById('filter-application').addEventListener('change', (e) => { state.application = e.target.value; render(); });
  document.getElementById('filter-portal').addEventListener('change', (e) => { state.portal = e.target.value; render(); });
  document.getElementById('reset').addEventListener('click', () => {
    state.search = ''; state.market = 'all'; state.verdict = 'all'; state.application = 'all'; state.portal = 'all'; state.statCard = null;
    document.getElementById('search').value = '';
    document.getElementById('filter-market').value = 'all';
    document.getElementById('filter-verdict').value = 'all';
    document.getElementById('filter-application').value = 'all';
    document.getElementById('filter-portal').value = 'all';
    render();
  });
  document.querySelectorAll('thead th[data-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = key === 'company' || key === 'title' ? 'asc' : 'desc'; }
      render();
    });
  });

  populatePortalFilter();
  populateApplicationFilter();
  render();
})();
</script>
</body>
</html>
`

function buildHtml({ jobs, stats, generatedAt }) {
  const dataJson = escapeForScriptTag(JSON.stringify({ jobs, stats, generatedAt }))
  return PAGE_TEMPLATE
    .replace("__GENERATED_AT__", generatedAt)
    .replace("__DATA_JSON__", dataJson)
}

async function main() {
  const data = JSON.parse(await Bun.file(JSON_PATH).text())
  const trackerByKey = await readTrackerRows()
  const visaDeadline = await readVisaDeadline()
  const jobs = buildJobs(data.seen ?? {}, trackerByKey, visaDeadline)
  const stats = computeStats(jobs)
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"

  const html = buildHtml({ jobs, stats, generatedAt })
  await Bun.write(OUT_PATH, html)
  console.log(`Wrote dashboard for ${jobs.length} jobs to ${OUT_PATH.pathname.replace(/^\//, "")}`)
}

main()
