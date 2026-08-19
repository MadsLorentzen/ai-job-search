// Shared data-building, HTML shell, and tracker-write logic for the live job dashboard
// served by serve_dashboard.js. There is no static-export mode: a bookmarked page can't
// write to job_search_tracker.csv without a server behind it (that's the whole point of
// the Apply / status-update buttons), so once the server exists there is no reason to
// also maintain a stale, read-only snapshot file alongside it. GET / serves the shell
// below unchanged; the client fetches /api/data itself, so nothing here needs to embed
// a data snapshot into the HTML.

const JSON_PATH = new URL("./seen_jobs.json", import.meta.url)
const TRACKER_PATH = new URL("../job_search_tracker.csv", import.meta.url)
const CLAUDE_MD_PATH = new URL("../CLAUDE.md", import.meta.url)

export const VALID_STATUSES = [
  "applied",
  "interview",
  "offer",
  "hired",
  "rejected",
  "no response",
  "offer declined",
  "withdrawn",
  "drafted",
  "skipped",
]

const TRACKER_HEADER = [
  "date",
  "company",
  "sector",
  "role",
  "role_type",
  "channel",
  "status",
  "contact_person",
  "fit_rating",
  "notes",
  "cv_file",
  "cover_letter_file",
  "source",
]

/**
 * Minimal RFC4180-ish CSV line parser/writer — only what's needed to read and write
 * back the tracker's own quoting (quotes doubled, fields with commas/newlines wrapped).
 * No external dependency, matching this repo's zero-dependency tooling convention.
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

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value)
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
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

function trackerKey(company, role) {
  return `${(company ?? "").trim().toLowerCase()}|${normalizeRole((role ?? "").trim().toLowerCase())}`
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
 * The dashboard's detail panel wants the full tracker row - date, fit_rating, notes,
 * cv_file, cover_letter_file, channel, contact_person - so this returns parsed rows
 * keyed by normalized company|role, last-match-wins (a re-application overwrites the
 * earlier row, which is the more current state to show).
 */
async function readTrackerRows(trackerPath) {
  const byKey = new Map()
  let text
  try {
    text = await Bun.file(trackerPath).text()
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
    byKey.set(trackerKey(company, role), {
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
  return trackerByKey.get(trackerKey(entry.company, entry.title)) ?? null
}

/** Relative-to-site-root link for a tracker file path like "cv/main_x.tex", preferring the compiled PDF sibling since that's what a human actually wants to open. serve_dashboard.js serves GET /cv/* and /cover_letters/* directly from the project root, so "../cv/x.pdf" normalizes to "/cv/x.pdf" against the server's root - see that file's isSafeStaticPath. */
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

/**
 * Deterministic 5-character base36 ID derived from the entry's own seen_jobs.json
 * key (URL, or company+title composite for portals without a clean URL - see the
 * schema note on that key format). Requires no stored state and no migration of
 * existing entries: the same key always hashes to the same ID, so it's stable
 * across re-scrapes and safe to use as a short human-referenceable handle in
 * conversation ("job A3F9K") instead of quoting a full URL.
 */
function shortId(key) {
  let hash = 5381
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36).slice(0, 5).toUpperCase()
}

function buildJobs(seen, trackerByKey, visaDeadline) {
  return Object.entries(seen).map(([key, entry]) => {
    const tracker = findTrackerRow(entry, trackerByKey)
    const market = inferMarket(entry.location_text)
    return {
      key,
      id: shortId(key),
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

/** Full data payload, read fresh from disk on every call - this is what GET /api/data returns, so every page load and every post-update refresh reflects current file state with no caching or regeneration step anywhere. */
export async function buildDashboardData() {
  const data = JSON.parse(await Bun.file(JSON_PATH).text())
  const trackerByKey = await readTrackerRows(TRACKER_PATH)
  const visaDeadline = await readVisaDeadline()
  const jobs = buildJobs(data.seen ?? {}, trackerByKey, visaDeadline)
  const stats = computeStats(jobs)
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"
  return { jobs, stats, generatedAt }
}

/**
 * Writes an application-status update straight to job_search_tracker.csv, mirroring
 * /outcome's Step 4 rules exactly: update status, overwrite `date` with today only when
 * leaving "drafted" (the tracker's date column means "applied on", not "drafted on"),
 * append a dated note rather than overwrite notes, and never restructure the CSV or
 * touch other rows. If no row matches (a job applied to outside the /apply workflow),
 * appends a new minimal row instead of failing - mirroring /outcome Step 1.2's "None ->
 * add a tracker row" behavior, just without the extra clarifying questions that command
 * asks conversationally.
 *
 * `trackerPath` defaults to the real tracker so callers don't need to pass it, but stays
 * overridable so tests can point at a scratch copy instead of mutating live data.
 */
export async function updateTrackerStatus({ company, role, status, note, source, fit_rating }, trackerPath = TRACKER_PATH) {
  if (!company || !role) return { ok: false, error: "company and role are required" }
  if (!VALID_STATUSES.includes(status)) {
    return { ok: false, error: `Unknown status "${status}". Valid: ${VALID_STATUSES.join(", ")}` }
  }

  let text = ""
  try {
    text = await Bun.file(trackerPath).text()
  } catch {
    text = TRACKER_HEADER.join(",") + "\n"
  }
  // Preserve whatever line ending the file already uses rather than forcing one -
  // this tracker is normally hand-edited via the Edit tool (plain \n), while
  // export_csv.js's seen_jobs.csv deliberately forces \r\n for Excel. Hardcoding
  // \r\n here would silently rewrite every line's bytes (not just the changed row)
  // on the very first write, which is surprising for a file the user may also be
  // versioning or diffing elsewhere.
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  let lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) lines = [TRACKER_HEADER.join(",")]

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  if (["date", "company", "role", "status", "notes"].some((c) => idx[c] === undefined)) {
    return { ok: false, error: "job_search_tracker.csv is missing one of the required columns (date/company/role/status/notes)" }
  }

  const targetKey = trackerKey(company, role)
  const today = new Date().toISOString().slice(0, 10)
  const dated = note ? `${note} (${today})` : `status -> ${status} (${today})`

  let matchIndex = -1
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i])
    if (trackerKey(f[idx.company], f[idx.role]) === targetKey) {
      matchIndex = i
      break
    }
  }

  if (matchIndex === -1) {
    const row = header.map((col) => {
      if (col === "date") return today
      if (col === "company") return company
      if (col === "role") return role
      if (col === "status") return status
      if (col === "channel") return "portal"
      if (col === "notes") return dated
      if (col === "source") return source ?? ""
      if (col === "fit_rating") return fit_rating ?? ""
      return ""
    })
    lines.push(row.map(csvEscape).join(","))
    await Bun.write(trackerPath, lines.join(eol) + eol)
    return { ok: true, created: true, message: `Added a new tracker row for ${company} and set status to "${status}".` }
  }

  const f = parseCsvLine(lines[matchIndex])
  while (f.length < header.length) f.push("")
  const oldStatus = (f[idx.status] ?? "").trim().toLowerCase()
  if (oldStatus === "drafted" && status !== "drafted") f[idx.date] = today
  f[idx.status] = status
  const existingNotes = f[idx.notes] ?? ""
  f[idx.notes] = existingNotes ? `${existingNotes}; ${dated}` : dated
  lines[matchIndex] = f.map(csvEscape).join(",")
  await Bun.write(trackerPath, lines.join(eol) + eol)
  return { ok: true, created: false, message: `Updated ${company} to "${status}".` }
}

/** Static page shell - no data embedded, nothing varies per request. The client fetches /api/data itself on load and after every write, so this same constant is returned by GET / every time. */
export const SHELL_HTML = String.raw`<!doctype html>
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
header .meta { color: var(--green); font-size: 13px; }
header .meta.error { color: var(--red); }
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
.controls input[type="search"] {
  background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 7px;
  padding: 7px 10px; font-size: 13px;
}
.controls input[type="search"] { flex: 1 1 220px; min-width: 160px; }
.controls button {
  background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 7px;
  padding: 7px 12px; font-size: 13px; cursor: pointer;
}
.controls button:hover { border-color: var(--accent); }
.result-count { font-size: 12px; color: var(--muted); margin-left: auto; white-space: nowrap; }

.multiselect { position: relative; flex: 0 0 auto; }
.ms-toggle {
  background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 7px;
  padding: 7px 10px; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.ms-toggle:hover { border-color: var(--accent); }
.multiselect.open .ms-toggle { border-color: var(--accent); }
.ms-panel {
  display: none; position: absolute; top: 100%; left: 0; margin-top: 4px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 7px; padding: 6px; min-width: 200px; max-height: 260px;
  overflow-y: auto; z-index: 20; box-shadow: 0 4px 14px rgba(0,0,0,.25);
}
.multiselect.open .ms-panel { display: block; }
.ms-option { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 5px; font-size: 13px; cursor: pointer; }
.ms-option:hover { background: var(--bg); }
.ms-option input { margin: 0; }
.ms-clear { display: block; width: 100%; text-align: left; background: none; border: none; color: var(--accent); font-size: 12px; padding: 5px 6px 8px; cursor: pointer; }
.ms-clear:hover { text-decoration: underline; }

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
.apply-btn {
  background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 4px 10px;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.apply-btn:hover { opacity: .88; }
.apply-btn:disabled { opacity: .5; cursor: default; }

.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 6px 4px 14px; }
.detail-grid h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; color: var(--muted); letter-spacing: .03em; }
.detail-grid ul { margin: 0; padding-left: 18px; font-size: 13px; }
.detail-grid ul li { margin-bottom: 3px; }
.detail-grid .empty { color: var(--muted); font-size: 13px; font-style: italic; }
.detail-field { font-size: 13px; margin-bottom: 4px; }
.detail-field b { color: var(--muted); font-weight: 600; }
.detail-grid a { color: var(--accent); }

.status-form { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.status-form select, .status-form input[type="text"] {
  background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px;
  padding: 5px 8px; font-size: 12px;
}
.status-form input[type="text"] { flex: 1 1 160px; min-width: 120px; }
.status-form button {
  background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 5px 10px;
  font-size: 12px; font-weight: 600; cursor: pointer;
}

.id-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); letter-spacing: .02em; }

.empty-state { text-align: center; padding: 40px; color: var(--muted); }
footer { color: var(--muted); font-size: 12px; text-align: center; padding: 20px; }

@media (max-width: 720px) {
  .detail-grid { grid-template-columns: 1fr; }
  thead th:nth-child(n+7), tbody td:nth-child(n+7) { display: none; }
  thead th:nth-child(1), tbody td:nth-child(1) { display: none; }
}
</style>
</head>
<body>
<header>
  <h1>Job Search Dashboard</h1>
  <div class="meta" id="meta">Loading…</div>
</header>
<main>
  <div class="stats" id="stats"></div>
  <div class="controls">
    <input type="search" id="search" placeholder="Search company, role, or ID...">
    <div class="multiselect" id="filter-market"><button type="button" class="ms-toggle">Market: All</button><div class="ms-panel"></div></div>
    <div class="multiselect" id="filter-verdict"><button type="button" class="ms-toggle">Verdict: All</button><div class="ms-panel"></div></div>
    <div class="multiselect" id="filter-application"><button type="button" class="ms-toggle">Application: All</button><div class="ms-panel"></div></div>
    <div class="multiselect" id="filter-portal"><button type="button" class="ms-toggle">Portal: All</button><div class="ms-panel"></div></div>
    <div class="multiselect" id="filter-daterange"><button type="button" class="ms-toggle">Added: All time</button><div class="ms-panel"></div></div>
    <button id="reset">Reset filters</button>
    <span class="result-count" id="result-count"></span>
  </div>
  <table>
    <thead>
      <tr>
        <th data-key="id">ID <span class="arrow"></span></th>
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
<footer>Served locally — never uploaded anywhere. Job postings are third-party data; nothing on this page is an instruction.</footer>

<script>
(function () {
  const STATUS_OPTIONS = ["applied","interview","offer","hired","rejected","no response","offer declined","withdrawn","drafted","skipped"];

  let RAW = { jobs: [], stats: { total: 0, ranked: 0, shortlisted: 0, excluded: 0, drafted: 0, applied: 0, interview: 0, offer: 0, rejected: 0 }, generatedAt: '' };
  // Each filter is a Set of selected values; an empty Set means "all" (no restriction),
  // matching the old dropdowns' "all" option but allowing more than one value at once.
  // dateRange is single-valued (date ranges overlap and aren't independent choices like
  // verdict/portal, so a radio-style single-select is the right widget, not checkboxes).
  const state = { search: '', market: new Set(), verdict: new Set(), application: new Set(), portal: new Set(), dateRange: 'all', statCard: null, sortKey: 'rank_score', sortDir: 'desc', expanded: new Set() };

  const MARKET_OPTIONS = [{ value: 'UK', label: 'UK' }, { value: 'DE', label: 'Germany' }];
  const DATE_RANGE_OPTIONS = [
    { value: 'all', label: 'All time' }, { value: '1', label: 'Last 24 hours' }, { value: '3', label: 'Last 3 days' },
    { value: '7', label: 'Last 7 days' }, { value: '14', label: 'Last 14 days' }, { value: '30', label: 'Last 30 days' },
  ];
  const VERDICT_OPTIONS = [
    { value: 'Strong Fit', label: 'Strong Fit' }, { value: 'Good Fit', label: 'Good Fit' },
    { value: 'Moderate Fit', label: 'Moderate Fit' }, { value: 'Weak Fit', label: 'Weak Fit' },
    { value: 'Poor Fit', label: 'Poor Fit' }, { value: 'unranked', label: 'Unranked' },
  ];

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

  async function refreshData() {
    const res = await fetch('/api/data');
    RAW = await res.json();
  }

  async function postStatus(job, status, note) {
    try {
      const res = await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: job.company, role: job.title, status, note, url: job.url, rank_score: job.rank_score }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) { alert('Update failed: ' + (body.error || res.statusText)); return false; }
      await refreshData();
      render();
      return true;
    } catch (err) {
      alert('Update failed: ' + err.message);
      return false;
    }
  }

  function portalOptions() {
    return Array.from(new Set(RAW.jobs.map(j => j.portal).filter(Boolean))).sort().map(p => ({ value: p, label: p }));
  }

  // "Not applied" is always offered even with zero matches (it's the default state for
  // most rows); every other status is only added once it actually appears in the tracker,
  // so the list grows on its own as the pipeline progresses (applied, interview, offer...)
  function applicationOptions() {
    const statuses = Array.from(new Set(RAW.jobs.map(j => j.application && j.application.status ? j.application.status.toLowerCase() : null).filter(Boolean))).sort();
    return [{ value: 'not_applied', label: 'Not applied' }, ...statuses.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))];
  }

  function multiSelectLabel(prefix, selected, options) {
    if (selected.size === 0) return prefix + ': All';
    if (selected.size === 1) {
      const only = options.find(o => o.value === [...selected][0]);
      return prefix + ': ' + (only ? only.label : [...selected][0]);
    }
    return prefix + ': ' + selected.size + ' selected';
  }

  function renderSingleSelect(containerId, prefix, options, currentValue, onSelect) {
    const container = document.getElementById(containerId);
    const toggle = container.querySelector('.ms-toggle');
    const panel = container.querySelector('.ms-panel');
    const current = options.find(o => o.value === currentValue);
    toggle.textContent = prefix + ': ' + (current ? current.label : 'All time');
    panel.innerHTML = '';
    for (const opt of options) {
      const label = el('label', { class: 'ms-option' });
      const radio = el('input', { attrs: { type: 'radio', name: containerId + '-radio' } });
      radio.checked = currentValue === opt.value;
      radio.addEventListener('change', () => {
        onSelect(opt.value);
        container.classList.remove('open');
        render();
      });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(opt.label));
      panel.appendChild(label);
    }
  }

  function renderMultiSelect(containerId, prefix, options, selected) {
    const container = document.getElementById(containerId);
    const toggle = container.querySelector('.ms-toggle');
    const panel = container.querySelector('.ms-panel');
    toggle.textContent = multiSelectLabel(prefix, selected, options);
    panel.innerHTML = '';
    const clearBtn = el('button', { class: 'ms-clear', text: 'Clear', attrs: { type: 'button' } });
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); selected.clear(); render(); });
    panel.appendChild(clearBtn);
    for (const opt of options) {
      const label = el('label', { class: 'ms-option' });
      const cb = el('input', { attrs: { type: 'checkbox' } });
      cb.checked = selected.has(opt.value);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(opt.value); else selected.delete(opt.value);
        render();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(opt.label));
      panel.appendChild(label);
    }
  }

  function applicationFilterValue(job) {
    return job.application && job.application.status ? job.application.status.toLowerCase() : 'not_applied';
  }
  function isVetoed(j) { return j.location_gate === 'FAIL' || j.language_gate === 'FAIL'; }
  function isShortlisted(j) { return j.rank_verdict && (j.rank_verdict === 'Strong Fit' || j.rank_verdict === 'Good Fit') && !isVetoed(j); }

  function matchesFilters(job) {
    if (state.search) {
      const hay = ((job.company || '') + ' ' + (job.title || '') + ' ' + (job.id || '')).toLowerCase();
      if (!hay.includes(state.search.toLowerCase())) return false;
    }
    if (state.market.size && !state.market.has(job.market)) return false;
    if (state.verdict.size && !state.verdict.has(job.rank_verdict || 'unranked')) return false;
    if (state.application.size && !state.application.has(applicationFilterValue(job))) return false;
    if (state.portal.size && !state.portal.has(job.portal)) return false;
    if (state.dateRange !== 'all') {
      if (!job.first_seen) return false;
      const days = Number(state.dateRange);
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - days);
      if (new Date(job.first_seen + 'T00:00:00') < cutoff) return false;
    }
    if (state.statCard === 'shortlisted' && !isShortlisted(job)) return false;
    if (state.statCard === 'excluded' && !isVetoed(job)) return false;
    if (state.statCard && ['drafted', 'applied'].includes(state.statCard) && applicationFilterValue(job) !== state.statCard) return false;
    if (state.statCard === 'interview' && !applicationFilterValue(job).includes('interview')) return false;
    if (state.statCard === 'offer' && !(applicationFilterValue(job).includes('offer') || applicationFilterValue(job) === 'hired')) return false;
    if (state.statCard === 'ranked' && !job.rank_verdict) return false;
    return true;
  }

  function sortValue(job, key) {
    if (key === 'id') return job.id || '';
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

  function statusForm(job) {
    const wrap = el('div', { class: 'status-form' });
    const select = el('select');
    for (const opt of STATUS_OPTIONS) {
      const o = el('option', { text: opt.charAt(0).toUpperCase() + opt.slice(1), attrs: { value: opt } });
      if (job.application && job.application.status && job.application.status.toLowerCase() === opt) o.selected = true;
      select.appendChild(o);
    }
    const note = el('input', { attrs: { type: 'text', placeholder: 'Add a note (optional)' } });
    const btn = el('button', { text: job.application ? 'Update status' : 'Mark applied / set status' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await postStatus(job, select.value, note.value.trim() || null);
      btn.disabled = false;
    });
    wrap.appendChild(select);
    wrap.appendChild(note);
    wrap.appendChild(btn);
    return wrap;
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
    right.appendChild(statusForm(job));

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

      tr.appendChild(el('td', { class: 'id-code', text: job.id || '—' }));

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

      const tdActions = el('td');
      if (!job.application) {
        const applyBtn = el('button', { class: 'apply-btn', text: 'Apply', attrs: { title: 'Mark this job as applied' } });
        applyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          applyBtn.disabled = true;
          const ok = await postStatus(job, 'applied', null);
          if (!ok) applyBtn.disabled = false;
        });
        tdActions.appendChild(applyBtn);
      } else if (job.url) {
        const a = el('a', { class: 'link-icon', text: '↗', attrs: { href: job.url, target: '_blank', rel: 'noopener', title: 'Open posting' } });
        a.addEventListener('click', (e) => e.stopPropagation());
        tdActions.appendChild(a);
      }
      tr.appendChild(tdActions);

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
    const filtered = RAW.jobs.filter(matchesFilters);
    const sorted = sortJobs(filtered);
    renderStats();
    renderTable(sorted);
    updateSortArrows();
    renderMultiSelect('filter-market', 'Market', MARKET_OPTIONS, state.market);
    renderMultiSelect('filter-verdict', 'Verdict', VERDICT_OPTIONS, state.verdict);
    renderMultiSelect('filter-application', 'Application', applicationOptions(), state.application);
    renderMultiSelect('filter-portal', 'Portal', portalOptions(), state.portal);
    renderSingleSelect('filter-daterange', 'Added', DATE_RANGE_OPTIONS, state.dateRange, (v) => { state.dateRange = v; });
    document.getElementById('result-count').textContent = 'Showing ' + sorted.length + ' of ' + RAW.jobs.length;
    const meta = document.getElementById('meta');
    meta.className = 'meta';
    meta.textContent = 'Live · ' + RAW.generatedAt + ' · Apply/status updates write straight to job_search_tracker.csv';
  }

  document.getElementById('search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  document.querySelectorAll('.multiselect .ms-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const container = btn.closest('.multiselect');
      const wasOpen = container.classList.contains('open');
      document.querySelectorAll('.multiselect.open').forEach(m => m.classList.remove('open'));
      if (!wasOpen) container.classList.add('open');
    });
  });
  document.querySelectorAll('.multiselect .ms-panel').forEach(panel => {
    panel.addEventListener('click', (e) => e.stopPropagation());
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.multiselect.open').forEach(m => m.classList.remove('open'));
  });
  document.getElementById('reset').addEventListener('click', () => {
    state.search = ''; state.market.clear(); state.verdict.clear(); state.application.clear(); state.portal.clear(); state.dateRange = 'all'; state.statCard = null;
    document.getElementById('search').value = '';
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

  (async function init() {
    try {
      await refreshData();
      render();
    } catch (err) {
      const meta = document.getElementById('meta');
      meta.className = 'meta error';
      meta.textContent = 'Could not reach the dashboard server at /api/data - is "bun run job_scraper/serve_dashboard.js" still running?';
    }
  })();
})();
</script>
</body>
</html>
`
