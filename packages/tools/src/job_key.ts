/**
 * Canonical dedup key for a job posting, and an audit for existing state.
 *
 * Port of tools/job_key.py (kept in sync until the Python tree is removed).
 * A key is a pure, deterministic function of company+title(+url): slugified
 * ASCII, length-capped with a sha1 disambiguator, non-Latin titles falling
 * back to the portal's numeric job id.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const COMPANY_MAX = 40;
export const TITLE_MAX = 60;
export const HASH_LEN = 6;

// Anything outside this set becomes a separator. "/" and "," are the
// characters that actually caused damage downstream (archive folder names).
const NON_SLUG = /[^a-z0-9]+/g;
const JOB_ID = /(\d{6,})/;
const CANONICAL = /^[a-z0-9][a-z0-9-]*_[a-z0-9][a-z0-9-]*$/;

/** Lowercase ASCII slug. Non-Latin scripts legitimately reduce to "". */
export function slugify(text: unknown): string {
  if (text === null || text === undefined) return "";
  const s = String(text);
  if (!s) return "";
  const decomposed = s.normalize("NFKD");
  // eslint-disable-next-line no-control-regex
  const asciiOnly = decomposed.replace(/[^\x20-\x7E]/g, "");
  return asciiOnly.toLowerCase().replace(NON_SLUG, "-").replace(/^-+|-+$/g, "");
}

function cap(slug: string, limit: number): string {
  if (slug.length <= limit) return slug;
  const digest = createHash("sha1").update(slug, "utf8").digest("hex").slice(0, HASH_LEN);
  return `${slug.slice(0, limit).replace(/-+$/g, "")}-${digest}`;
}

/** The canonical seen_jobs.json key for one posting. */
export function makeKey(company: string, title: string, url = ""): string {
  const companySlug = cap(slugify(company), COMPANY_MAX) || "unknown-company";
  let titleSlug = cap(slugify(title), TITLE_MAX);
  if (!titleSlug) {
    // No Latin characters in the title: the portal's numeric id is the only
    // stable handle left; never emit a bare "company_" prefix.
    const match = JOB_ID.exec(url || "");
    if (match) {
      titleSlug = match[1]!;
    } else {
      const basis = slugify(String(title || url || "").normalize("NFKD"));
      const digest = createHash("sha1")
        .update(String(title) + String(url), "utf8")
        .digest("hex")
        .slice(0, HASH_LEN);
      titleSlug = basis || `untitled-${digest}`;
    }
  }
  return `${companySlug}_${titleSlug}`;
}

/** Structurally safe as a dedup key and as an archive folder name. */
export function isCanonical(key: string): boolean {
  return Boolean(key) && CANONICAL.test(key);
}

/** Old three-part "company_title_location" keys - drift, not damage. */
export function isLegacyShape(key: string): boolean {
  if (!key) return false;
  const parts = key.split("_");
  return key.split("_").length - 1 > 1 && parts.every((p) => !!p && /^[a-z0-9][a-z0-9-]*$/.test(p));
}

export interface AuditReport {
  entries: number;
  malformed_keys: string[];
  legacy_three_part_keys: string[];
  duplicate_urls: Record<string, string[]>;
  keys_not_matching_current_rule: number;
}

export function auditDoc(doc: unknown): AuditReport {
  const seen =
    typeof doc === "object" && doc !== null && "seen" in (doc as Record<string, unknown>)
      ? (doc as Record<string, unknown>).seen
      : doc;
  const entries = (seen ?? {}) as Record<string, Record<string, unknown>>;
  const malformed = Object.keys(entries).filter((k) => !isCanonical(k) && !isLegacyShape(k));
  const legacy = Object.keys(entries).filter((k) => isLegacyShape(k));
  const byUrl = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(entries)) {
    const url = String(entry?.url ?? "").replace(/\/+$/, "");
    if (url) {
      const list = byUrl.get(url) ?? [];
      list.push(key);
      byUrl.set(url, list);
    }
  }
  const duplicates: Record<string, string[]> = {};
  for (const [u, ks] of byUrl) if (ks.length > 1) duplicates[u] = ks;
  let drift = 0;
  for (const [k, v] of Object.entries(entries)) {
    if (
      isCanonical(k) &&
      k !== makeKey(String(v?.company ?? ""), String(v?.title ?? ""), String(v?.url ?? ""))
    )
      drift++;
  }
  return {
    entries: Object.keys(entries).length,
    malformed_keys: malformed,
    legacy_three_part_keys: legacy,
    duplicate_urls: duplicates,
    keys_not_matching_current_rule: drift,
  };
}

export function audit(path: string): number {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (exc) {
    process.stderr.write(`cannot read ${path}: ${(exc as Error).message}\n`);
    return 1;
  }
  const seen =
    typeof doc === "object" && doc !== null && "seen" in (doc as Record<string, unknown>)
      ? (doc as Record<string, unknown>).seen
      : doc;
  if (typeof seen !== "object" || seen === null || Array.isArray(seen)) {
    process.stderr.write(`${path}: expected an object of job entries\n`);
    return 1;
  }
  const report = auditDoc(doc);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return report.malformed_keys.length || Object.keys(report.duplicate_urls).length ? 1 : 0;
}

export function jobKeyMain(argv: string[]): number {
  let company: string | undefined;
  let title: string | undefined;
  let url = "";
  let auditArg: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--company") company = argv[++i];
    else if (a === "--title") title = argv[++i];
    else if (a === "--url") url = argv[++i] ?? "";
    else if (a === "--audit") {
      auditArg = argv[++i] ?? String(jobKeyDefaultState());
    } else {
      process.stderr.write(`unknown argument: ${a}\n`);
      return 2;
    }
  }
  if (auditArg !== undefined) return audit(auditArg);
  if (company === undefined || title === undefined) {
    process.stderr.write("give --company and --title, or --audit\n");
    return 2;
  }
  process.stdout.write(makeKey(company, title, url) + "\n");
  return 0;
}

export function jobKeyDefaultState(): string {
  // packages/tools/src -> repo root / job_scraper / seen_jobs.json
  const root = new URL("../../../..", import.meta.url).pathname;
  return `${root}job_scraper/seen_jobs.json`;
}
