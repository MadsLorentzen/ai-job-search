/**
 * State helper for /rank: select candidates, sweep expired entries, and
 * write scoring results back to seen_jobs.json.
 *
 * Port of tools/rank_state.py (kept in sync until the Python tree is removed).
 * Selection/projection follow Step 1's rules; the sweep follows rule 6
 * (defensive date parsing, absent deadline left alone); the write-back follows
 * Step 4 (location_verdict legacy migration, deadline null-is-not-a-correction,
 * verbatim strengths/gaps, capped at 3).
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

// 04-job-evaluation.md
const WEIGHTS: Record<string, number> = {
  technical: 0.3,
  experience: 0.25,
  behavioral: 0.15,
  career: 0.3,
};
const BANDS: [number, string][] = [
  [75, "Strong Fit"],
  [60, "Good Fit"],
  [45, "Moderate Fit"],
  [30, "Weak Fit"],
  [0, "Poor Fit"],
];

const DEFAULT_LIMIT = 10;
const URGENT_DAYS = 7;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// packages/tools/src -> repo root
const ROOT = new URL("../../..", import.meta.url).pathname;
export const STATE_PATH = join(ROOT, "job_scraper", "seen_jobs.json");
export const TRACKER_PATH = join(ROOT, "job_search_tracker.csv");

type Entry = Record<string, any>;

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

export function loadState(path: string): { doc: any; seen: Record<string, Entry> } {
  if (!existsSync(path)) fail(`${path} not found - run /scrape first`);
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (exc) {
    fail(`${path} is not valid JSON: ${(exc as Error).message}`);
  }
  const seen =
    doc && typeof doc === "object" && !Array.isArray(doc) && "seen" in doc ? doc.seen : doc;
  if (typeof seen !== "object" || seen === null || Array.isArray(seen)) {
    fail(`${path}: expected an object of job entries`);
  }
  return { doc, seen: seen as Record<string, Entry> };
}

/** Atomic replace: a half-written seen_jobs.json loses the scrape history. */
export function saveState(path: string, doc: any): void {
  const tmp = join(dirname(path), `.seen_jobs.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    renameSync(tmp, path);
  } catch (exc) {
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw exc;
  }
}

/** Rule 6's defensive-parse rule: non-YYYY-MM-DD is treated as absent. */
export function parseIso(value: unknown): string | null {
  if (typeof value !== "string" || !ISO.test(value.trim())) return null;
  const t = value.trim();
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return t;
}

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function norm(text: unknown): string {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** company+role pairs already in the tracker - out of scope for ranking. */
export function trackerPairs(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return new Set();
  const header = splitCsvLine(lines[0]!).map((h) => h.trim());
  const companyIdx = header.indexOf("company");
  const roleIdx = header.indexOf("role");
  const pairs = new Set<string>();
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const company = norm(companyIdx >= 0 ? cols[companyIdx] : "");
    const role = norm(roleIdx >= 0 ? cols[roleIdx] : "");
    if (company) pairs.add(`${company}\u0000${role}`);
  }
  return pairs;
}

/** Minimal CSV line splitter handling quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** location_verdict, falling back to a legacy verdict stored under `location`. */
function entryLocationVerdict(entry: Entry): string | null {
  const verdict = entry.location_verdict;
  if (verdict) return verdict;
  const legacy = entry.location;
  return ["PASS", "FAIL", "FLAG"].includes(legacy) ? legacy : null;
}

export function overallScore(scores: Record<string, unknown>): number {
  let total = 0;
  for (const [dim, weight] of Object.entries(WEIGHTS)) {
    const value = (scores as any)[dim];
    if (typeof value !== "number") throw new Error(`missing or non-numeric score '${dim}'`);
    total += value * weight;
  }
  return Math.trunc(total + 0.5);
}

export function band(score: number): string {
  for (const [floor, name] of BANDS) if (score >= floor) return name;
  return "Poor Fit";
}

export interface CandidatesOptions {
  state: string;
  tracker: string;
  all: boolean;
  focus?: string;
  limit: number;
}

export function cmdCandidates(args: CandidatesOptions): number {
  const { seen } = loadState(args.state);
  const excluded = trackerPairs(args.tracker);

  const selected: any[] = [];
  let skippedTracker = 0;
  for (const [key, entry] of Object.entries(seen)) {
    const status = entry.status;
    if (args.all) {
      if (status === "skipped") continue;
    } else if (status !== "new") continue;
    if (excluded.has(`${norm(entry.company)}\u0000${norm(entry.title)}`)) {
      skippedTracker++;
      continue;
    }
    if (args.focus) {
      const haystack = [
        String(entry.title ?? ""),
        String(entry.company ?? ""),
        ...((entry.strengths ?? []) as unknown[]).map(String),
        ...((entry.gaps ?? []) as unknown[]).map(String),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(args.focus.toLowerCase())) continue;
    }
    selected.push({
      key,
      title: entry.title ?? null,
      company: entry.company ?? null,
      url: entry.url ?? null,
      portal: entry.portal ?? null,
      deadline: entry.deadline ?? null,
      posted_date: entry.posted_date ?? null,
    });
  }

  const eligible = selected.length;
  const limited = args.limit > 0 ? selected.slice(0, args.limit) : selected;
  process.stdout.write(
    JSON.stringify(
      {
        eligible,
        selected: limited,
        deferred: Math.max(0, eligible - limited.length),
        excluded_by_tracker: skippedTracker,
        total_entries: Object.keys(seen).length,
      },
      null,
      2,
    ) + "\n",
  );
  return 0;
}

export interface SweepOptions {
  state: string;
  today: string;
  write: boolean;
  exclude?: string;
}

export function cmdSweep(args: SweepOptions): number {
  const { doc, seen } = loadState(args.state);
  const today = isoToDate(args.today);
  const exclude = new Set((args.exclude ?? "").split(",").filter(Boolean));

  const expired: any[] = [];
  const closing: any[] = [];
  const unparseable: any[] = [];
  let checked = 0;
  for (const [key, entry] of Object.entries(seen)) {
    if (entry.status !== "ranked" || exclude.has(key)) continue;
    checked++;
    const raw = entry.deadline;
    if (raw === null || raw === undefined || raw === "") continue;
    const parsed = parseIso(raw);
    if (parsed === null) {
      unparseable.push({ key, portal: entry.portal ?? null, deadline: raw });
      continue;
    }
    const row = {
      key,
      title: entry.title ?? null,
      company: entry.company ?? null,
      url: entry.url ?? null,
      deadline: raw,
    };
    const days = Math.round((isoToDate(parsed).getTime() - today.getTime()) / 86400000);
    if (days < 0) expired.push(row);
    else if (days <= URGENT_DAYS) closing.push(row);
  }

  if (args.write && expired.length) {
    for (const row of expired) seen[row.key].status = "expired";
    saveState(args.state, doc);
  }
  closing.sort((a, b) => (a.deadline < b.deadline ? -1 : 1));

  process.stdout.write(
    JSON.stringify(
      {
        swept: checked,
        newly_expired: expired,
        closing_soon: closing,
        unparseable_deadlines: unparseable,
        written: Boolean(args.write && expired.length),
      },
      null,
      2,
    ) + "\n",
  );
  return 0;
}

export interface ApplyOptions {
  state: string;
  today: string;
  results: string;
  dryRun: boolean;
}

export function cmdApply(args: ApplyOptions): number {
  const { doc, seen } = loadState(args.state);
  const today = args.today;
  let results: any;
  try {
    results = JSON.parse(readFileSync(args.results, "utf8"));
  } catch (exc) {
    fail(`cannot read results file ${args.results}: ${(exc as Error).message}`);
  }
  if (results && typeof results === "object" && !Array.isArray(results)) results = results.results ?? [];
  if (!Array.isArray(results)) fail("results file must be a JSON array of scoring objects");

  const rows: any[] = [];
  const expired: any[] = [];
  const errors: any[] = [];
  for (const result of results) {
    const key = result?.key;
    const entry = seen[key as string];
    if (!entry) {
      errors.push({ key: key ?? null, error: "no such key in seen_jobs.json" });
      continue;
    }

    if (result.status === "expired") {
      entry.status = "expired";
      expired.push({
        key,
        title: entry.title ?? null,
        company: entry.company ?? null,
        url: entry.url ?? null,
      });
      continue;
    }

    let score: number;
    try {
      score = overallScore(result.scores ?? {});
    } catch (exc) {
      errors.push({ key, error: (exc as Error).message });
      continue;
    }

    const legacy = entryLocationVerdict(entry);
    if (["PASS", "FAIL", "FLAG"].includes(entry.location)) delete entry.location; // legacy verdict, never a place
    entry.status = "ranked";
    entry.rank_score = score;
    entry.rank_verdict = band(score);
    entry.rank_date = today;
    entry.location_verdict = result.location_verdict || legacy || "PASS";
    entry.language_gate = result.language_gate || "PASS";
    if (entry.language_gate === "PASS") delete entry.language_note;
    else entry.language_note = result.language_note ?? undefined;
    // Absence is not a correction: a null deadline must not erase a stored one.
    if (result.deadline) entry.deadline = result.deadline;
    for (const field of ["strengths", "gaps"] as const) {
      const value = result[field];
      if (Array.isArray(value)) entry[field] = value.map(String).slice(0, 3);
    }

    const parsed = parseIso(entry.deadline);
    const todayD = isoToDate(today);
    const dl = parsed ? isoToDate(parsed) : null;
    rows.push({
      key,
      title: entry.title ?? null,
      company: entry.company ?? null,
      location: entry.location ?? null,
      url: entry.url ?? null,
      score,
      verdict: entry.rank_verdict,
      location_verdict: entry.location_verdict,
      language_gate: entry.language_gate,
      language_note: entry.language_note ?? null,
      deadline: entry.deadline ?? null,
      posted_date: entry.posted_date ?? null,
      urgent: Boolean(
        dl && todayD.getTime() <= dl.getTime() && dl.getTime() <= todayD.getTime() + URGENT_DAYS * 86400000,
      ),
      strengths: entry.strengths ?? [],
      gaps: entry.gaps ?? [],
    });
  }

  if (!args.dryRun) saveState(args.state, doc);

  rows.sort((a, b) => (a.score === b.score ? Number(b.urgent) - Number(a.urgent) : b.score - a.score));
  const veto = (r: any) => r.location_verdict === "FAIL" || r.language_gate === "FAIL";
  process.stdout.write(
    JSON.stringify(
      {
        ranked: rows.filter((r) => !veto(r)),
        vetoed: rows.filter(veto),
        expired,
        errors,
        written: !args.dryRun,
      },
      null,
      2,
    ) + "\n",
  );
  return errors.length ? 1 : 0;
}

export function rankStateMain(argv: string[]): number {
  const [command, ...rest] = argv;
  if (!command) {
    process.stderr.write(
      "usage: rank-state candidates|sweep|apply [--state P] [--today DATE] ...\n",
    );
    return 2;
  }

  // Common flags for every subcommand.
  let state = STATE_PATH;
  let today = new Date().toISOString().slice(0, 10);
  const sub: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--state") state = rest[++i]!;
    else if (a === "--today") {
      const t = rest[++i]!;
      if (!parseIso(t)) fail(`--today must be YYYY-MM-DD`);
      today = t.trim();
    } else sub.push(a);
  }

  const popFlag = (name: string): boolean => {
    const idx = sub.indexOf(name);
    if (idx === -1) return false;
    sub.splice(idx, 1);
    return true;
  };
  const popValue = (name: string): string | undefined => {
    const idx = sub.indexOf(name);
    if (idx === -1) return undefined;
    const v = sub[idx + 1];
    sub.splice(idx, 2);
    return v;
  };

  if (command === "candidates") {
    const tracker = popValue("--tracker") ?? TRACKER_PATH;
    const all = popFlag("--all");
    const focus = popValue("--focus");
    const limitRaw = popValue("--limit");
    if (limitRaw !== undefined && !/^-?\d+$/.test(limitRaw)) fail(`--limit must be an integer`);
    const limit = limitRaw !== undefined ? parseInt(limitRaw, 10) : DEFAULT_LIMIT;
    for (const extra of sub) {
      process.stderr.write(`unknown argument: ${extra}\n`);
      return 2;
    }
    return cmdCandidates({ state, tracker, all, focus, limit });
  }
  if (command === "sweep") {
    const write = popFlag("--write");
    const exclude = popValue("--exclude");
    for (const extra of sub) {
      process.stderr.write(`unknown argument: ${extra}\n`);
      return 2;
    }
    return cmdSweep({ state, today, write, exclude });
  }
  if (command === "apply") {
    const results = popValue("--results");
    if (!results) {
      process.stderr.write("--results is required\n");
      return 2;
    }
    const dryRun = popFlag("--dry-run");
    for (const extra of sub) {
      process.stderr.write(`unknown argument: ${extra}\n`);
      return 2;
    }
    return cmdApply({ state, today, results, dryRun });
  }
  process.stderr.write(`unknown subcommand: ${command}\n`);
  return 2;
}
