/**
 * Supply-chain guards for the template's riskiest surfaces.
 *
 * Port of tools/security_guards.py; paths updated for the pi-agent layout
 * (skills under .pi-agent/skills/, agent settings in .pi-agent/settings.json).
 *
 * Usage: bun run packages/tools/src/cli.ts security-guards
 *
 * Checks:
 * 1. .pi-agent/settings.json — permissions.allow entries and hooks must be in
 *    the exact allowlists below. A hook runs automatically when its event
 *    fires, with no prompt, so it is strictly more dangerous than a
 *    pre-approved permission.
 * 2. .gitignore — the personal-data ignore rules must all still be present,
 *    and no un-allowlisted negation (!pattern) may re-include them.
 * 3. package.json manifests under .pi-agent/ and packages/ (node_modules
 *    excluded) — no bun/npm lifecycle scripts and no trustedDependencies.
 *
 * Exit 0 on success, 1 with a failure list otherwise.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;

export const errors: string[] = [];

// The exact permission entries the template ships. A PR that adds or changes
// an entry must add it here too - that is the point: the diff shows both.
export const ALLOWED_PERMISSIONS = new Set([
  "Skill(job-application-assistant)",
  // One entry per shipped portal CLI, matching what each SKILL.md already
  // declares in its allowed-tools. A portal added by /add-portal needs its
  // own entry here and in .pi-agent/settings.json - that review step is
  // the point.
  "Bash(bun run .pi-agent/skills/jobbank-search/cli/src/cli.ts:*)",
  "Bash(bun run .pi-agent/skills/jobdanmark-search/cli/src/cli.ts:*)",
  "Bash(bun run .pi-agent/skills/jobindex-search/cli/src/cli.ts:*)",
  "Bash(bun run .pi-agent/skills/jobnet-search/cli/src/cli.ts:*)",
  "Bash(bun run .pi-agent/skills/linkedin-search/cli/src/cli.ts:*)",
  "Bash(bun run .pi-agent/skills/freehire-search/cli/src/cli.ts:*)",
  "Bash(bun run packages/tools/src/cli.ts salary-lookup:*)",
  "Bash(pdftotext:*)",
]);

// Personal-data ignore rules that must never disappear from .gitignore.
export const REQUIRED_IGNORE_RULES = [
  "salary_data.json",
  // The dedup backlog lives at state/seen_jobs.json (repo-rooted).
  "state/seen_jobs.json",
  // Depth-independent: the job-scraper skill resolves `job_scraper/` relative
  // to its own directory, so the state file can land under
  // .pi-agent/skills/... and a repo-rooted rule silently fails to match it.
  "**/job_scraper/seen_jobs.json",
  "**/job_scraper/notion_sync.json",
  "**/job_scraper/*.md",
  "*_BehavioralReport.pdf",
  "linkedin_Profile.pdf",
  "cv/main_*.*",
  "!cv/main_example.tex",
  // ATS text extractions (/apply step 5d) carry the CV's full text.
  "cv/*.txt",
  "cover_letters/cover_*.*",
  // /apply also recognizes the uppercase Cover_* naming variant.
  "cover_letters/Cover_*.*",
  "documents/cv/**",
  "documents/linkedin/**",
  "documents/diplomas/**",
  "documents/references/**",
  "applications/**",
  "postings/**",
  // Belt-and-braces, not the primary guard: nothing writes here.
  
  "job_search_tracker.csv",
  "gmail_sync/",
  "reports/",
  "upskill/*.md",
  // Depth-independent twin of the rule above: the upskill skill resolves
  // `upskill/` relative to its own directory, so reports can land at
  // .pi-agent/skills/upskill/upskill/*.md where the rooted rule cannot see
  // them. `**/upskill/*.md` would also ignore the skill's own SKILL.md, so
  // the report-file prefix is pinned.
  "**/upskill/report-*.md",
  ".env",
  ".env.*",
  "company_research/*.json",
];

// Negation (re-include) rules the template legitimately ships. .gitignore is
// order-sensitive: a later `!pattern` re-includes a path an earlier rule
// excluded, so a rule can be physically present in REQUIRED_IGNORE_RULES yet
// no longer ignored. Any negation outside this allowlist is a failure.
export const ALLOWED_IGNORE_NEGATIONS = new Set([
  "!cover_letters/OpenFonts/fonts/**",
  "!cv/main_example.tex",
  "!cover_letters/cover_example.tex",
  "!documents/**/.gitkeep",
]);

// Hook commands the template legitimately ships, as "<Event>:<command>"
// strings. Empty by design - the template ships no hooks at all.
//
// A hook is strictly more dangerous than a permissions.allow entry: it runs
// unconditionally when its event fires, with no prompt and no model decision
// in between. Cloning a repo and opening it is enough (the Shai-Hulud worm's
// August 2026 wave planted a SessionStart hook).
export const ALLOWED_HOOKS = new Set<string>();

export const FORBIDDEN_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepack",
]);

const GUARD_SOURCE = "packages/tools/src/security_guards.ts";

function* hookCommands(event: string, entries: unknown): Generator<string> {
  // Fails closed: any shape this does not recognise yields a marker that
  // cannot be in the allowlist, so an unfamiliar hook layout is rejected
  // rather than silently skipped.
  const unrecognised = `${event}:<unrecognised hook shape>`;
  if (!Array.isArray(entries)) {
    yield unrecognised;
    return;
  }
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      yield unrecognised;
      continue;
    }
    const inner = (entry as Record<string, unknown>)["hooks"];
    if (!Array.isArray(inner)) {
      yield unrecognised;
      continue;
    }
    for (const hook of inner) {
      const command =
        typeof hook === "object" && hook !== null
          ? (hook as Record<string, unknown>)["command"]
          : null;
      yield typeof command === "string" ? `${event}:${command}` : unrecognised;
    }
  }
}

function checkPermissions(root: string): void {
  const path = join(root, ".pi-agent", "settings.json");
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (exc) {
    errors.push(`.pi-agent/settings.json: unreadable or invalid JSON: ${exc}`);
    return;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push(".pi-agent/settings.json: top-level JSON value must be an object");
    return;
  }
  const obj = data as Record<string, unknown>;

  // Checked before the permissions shape guards below, so a file that pairs a
  // malformed permissions block with a hook cannot return early and skip this.
  const hooks = obj["hooks"];
  if (hooks !== undefined && hooks !== null) {
    if (typeof hooks !== "object" || Array.isArray(hooks)) {
      errors.push(".pi-agent/settings.json: hooks must be an object");
    } else {
      for (const [event, entries] of Object.entries(
        hooks as Record<string, unknown>,
      )) {
        for (const command of hookCommands(event, entries)) {
          if (!ALLOWED_HOOKS.has(command)) {
            errors.push(
              `.pi-agent/settings.json: hook not in the reviewed allowlist: ` +
                `'${command}'. A hook runs automatically when its event fires - it ` +
                "is never gated by the permissions prompt, so it executes on every " +
                "fork without the user agreeing to anything. If this hook is " +
                `intentional, add it to ALLOWED_HOOKS in ${GUARD_SOURCE} ` +
                "in the same PR so the addition is explicit and reviewable.",
            );
          }
        }
      }
    }
  }

  const permissions = obj["permissions"];
  if (permissions === undefined) return;
  if (
    typeof permissions !== "object" ||
    permissions === null ||
    Array.isArray(permissions)
  ) {
    errors.push(".pi-agent/settings.json: permissions must be an object");
    return;
  }
  const allow = (permissions as Record<string, unknown>)["allow"];
  if (
    !Array.isArray(allow) ||
    !allow.every((entry) => typeof entry === "string")
  ) {
    errors.push(
      ".pi-agent/settings.json: permissions.allow must be a list of strings",
    );
    return;
  }
  for (const entry of allow) {
    if (!ALLOWED_PERMISSIONS.has(entry)) {
      errors.push(
        `.pi-agent/settings.json: permission not in the reviewed allowlist: '${entry}'. ` +
          "Pre-approved permissions run without prompting on every fork. If this entry is " +
          `intentional, add it to ALLOWED_PERMISSIONS in ${GUARD_SOURCE} in the ` +
          "same PR so the widening is explicit and reviewable.",
      );
    }
  }
  for (const entry of ALLOWED_PERMISSIONS) {
    // Not an error: settings may legitimately drop an entry. But an
    // allowlist entry that no longer exists should be pruned.
    if (!allow.includes(entry)) {
      console.log(
        `note: allowlisted permission not present in settings.json: '${entry}'`,
      );
    }
  }
}

function checkGitignore(root: string): void {
  let lines: string[];
  try {
    lines = readFileSync(join(root, ".gitignore"), "utf8")
      .split("\n")
      .map((l) => l.trim());
  } catch (exc) {
    errors.push(`.gitignore: unreadable: ${exc}`);
    return;
  }
  const rules = new Set(lines);
  for (const rule of REQUIRED_IGNORE_RULES) {
    if (!rules.has(rule)) {
      errors.push(
        `.gitignore: required personal-data rule missing: '${rule}'. ` +
          "These rules keep fork users from committing personal data. If the rule moved " +
          "or was renamed intentionally, update REQUIRED_IGNORE_RULES in " +
          `${GUARD_SOURCE} in the same PR.`,
      );
    }
  }
  for (const line of lines) {
    if (line.startsWith("!") && !ALLOWED_IGNORE_NEGATIONS.has(line)) {
      errors.push(
        `.gitignore: negation rule not in the reviewed allowlist: '${line}'. ` +
          "A negation re-includes a path an earlier rule excluded and can silently " +
          "re-expose personal data (a required ignore rule stays present but stops " +
          "taking effect). If this negation is intentional, add it to " +
          `ALLOWED_IGNORE_NEGATIONS in ${GUARD_SOURCE} in the same PR.`,
      );
    }
  }
}

function findManifests(dir: string, acc: string[]): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules") continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) findManifests(full, acc);
    else if (ent.name === "package.json") acc.push(full);
  }
}

function checkPackageManifests(root: string): void {
  const globs = [join(root, ".pi-agent"), join(root, "packages")];
  const manifests: string[] = [];
  for (const g of globs) findManifests(g, manifests);
  if (manifests.length === 0) {
    errors.push(
      "no package.json files found under .pi-agent/ or packages/ - glob roots are wrong or the tree moved",
    );
  }
  for (const manifest of manifests) {
    const relpath = manifest.slice(root.length + 1);
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(manifest, "utf8"));
    } catch (exc) {
      errors.push(`${relpath}: unreadable or invalid JSON: ${exc}`);
      continue;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      errors.push(`${relpath}: top-level JSON value must be an object`);
      continue;
    }
    const obj = data as Record<string, unknown>;
    const scripts = obj["scripts"] ?? {};
    if (
      typeof scripts !== "object" ||
      scripts === null ||
      Array.isArray(scripts)
    ) {
      errors.push(`${relpath}: scripts must be an object`);
      continue;
    }
    const bad = Object.keys(scripts).filter((k) => FORBIDDEN_SCRIPTS.has(k));
    if (bad.length > 0) {
      errors.push(
        `${relpath}: lifecycle script(s) ${JSON.stringify([...bad].sort())} are forbidden - they execute ` +
          "arbitrary code during `bun install` on every fork user's machine.",
      );
    }
    if ("trustedDependencies" in obj) {
      errors.push(
        `${relpath}: trustedDependencies is forbidden - it re-enables dependency ` +
          "lifecycle scripts that bun blocks by default.",
      );
    }
  }
}

export function securityGuardsMain(_argv: string[] = [], root: string = ROOT): number {
  errors.length = 0;
  checkPermissions(root);
  checkGitignore(root);
  checkPackageManifests(root);
  if (errors.length > 0) {
    console.log(`security_guards: ${errors.length} failure(s)`);
    for (const err of errors) console.log(`  - ${err}`);
    return 1;
  }
  console.log(
    "security_guards: OK (permissions allowlist, hooks allowlist, gitignore rules, " +
      "package manifests)",
  );
  return 0;
}
