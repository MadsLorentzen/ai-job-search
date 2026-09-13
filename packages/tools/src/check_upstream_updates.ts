/**
 * Check for framework updates in the upstream repository.
 *
 * Port of tools/check_upstream_updates.py; the framework files live under
 * .pi-agent/skills/job-application-assistant/ after the pi-agent migration.
 *
 * Usage: bun run packages/tools/src/cli.ts upstream-updates
 *        [--remote <name>] [--branch <name>] [--no-fetch]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;

const FRAMEWORK_FILES = [
  ".pi-agent/skills/job-application-assistant/01-candidate-profile.md",
  ".pi-agent/skills/job-application-assistant/02-behavioral-profile.md",
  ".pi-agent/skills/job-application-assistant/03-writing-style.md",
  ".pi-agent/skills/job-application-assistant/04-job-evaluation.md",
  ".pi-agent/skills/job-application-assistant/05-cv-templates.md",
  ".pi-agent/skills/job-application-assistant/06-cover-letter-templates.md",
  ".pi-agent/skills/job-application-assistant/07-interview-prep.md",
  ".pi-agent/skills/job-application-assistant/08-application-forms.md",
  ".pi-agent/skills/job-application-assistant/09-web-research.md",
  ".pi-agent/skills/job-application-assistant/SKILL.md",
  "AGENTS.md",
];

export const UPSTREAM_REPO_SLUG = "MadsLorentzen/ai-job-search";

export function runGit(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

export function getRemoteUrl(remoteName: string, root: string): string {
  const { status, stdout } = runGit(["remote", "get-url", remoteName], root);
  return status === 0 ? stdout.trim() : "";
}

export function getFrameworkVersionFromText(text: string): string | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  for (const line of text.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx !== -1 && line.slice(0, idx).trim() === "framework_version") {
      return line
        .slice(idx + 1)
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/^'|'$/g, "");
    }
  }
  return null;
}

export function parseSemver(versionStr: string): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(versionStr);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

export function upstreamUpdatesMain(argv: string[], root: string = ROOT): number {
  let remote = "upstream";
  let branch = "master";
  let noFetch = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--remote") remote = argv[++i]!;
    else if (a === "--branch") branch = argv[++i]!;
    else if (a === "--no-fetch") noFetch = true;
  }
  const requestedRemote = remote;

  // Verify remote exists
  const remotes = runGit(["remote"], root).stdout.split("\n").filter(Boolean);
  if (!remotes.includes(remote)) {
    if (remotes.includes("origin")) {
      console.log(`Warning: Remote '${remote}' not found. Falling back to 'origin'.`);
      remote = "origin";
    } else {
      console.log("Error: No git remotes found.");
      return 1;
    }
  }

  // A fork's own 'origin' can never reveal upstream updates: warn so the
  // user is not misled by the final '[OK]' line below. (Direct clones of
  // the template repo have origin == the upstream repo, so no warning.)
  // GitHub serves repo paths case-insensitively, so compare lowercased.
  if (
    remote !== requestedRemote &&
    !getRemoteUrl(remote, root).toLowerCase().includes(UPSTREAM_REPO_SLUG.toLowerCase())
  ) {
    console.log(
      `Warning: Remote '${remote}' does not point to the ai-job-search ` +
        `template repo (${UPSTREAM_REPO_SLUG}), so this check compares your ` +
        `fork against itself and will never report upstream updates. ` +
        `Add the template repo as a remote to track upstream changes, e.g.:\n` +
        `  git remote add upstream https://github.com/${UPSTREAM_REPO_SLUG}.git`,
    );
  }

  if (!noFetch) {
    console.log(`Fetching latest from remote '${remote}'...`);
    const { status, stderr } = runGit(["fetch", remote], root);
    if (status !== 0) {
      console.log(`Warning: Failed to fetch from remote '${remote}': ${stderr.trim()}`);
      console.log("Proceeding with cached remote tracking branches.");
    }
  }

  const ref = `${remote}/${branch}`;
  if (runGit(["rev-parse", "--verify", ref], root).status !== 0) {
    console.log(
      `Error: Ref '${ref}' does not exist. Make sure you fetched and specified the correct branch.`,
    );
    return 1;
  }

  console.log(`Comparing local files against upstream '${ref}'...\n`);

  const updatesAvailable: { filename: string; local: string; upstream: string; path: string }[] = [];
  const errors: string[] = [];
  const missingUpstream: string[] = [];

  for (const relPath of FRAMEWORK_FILES) {
    const localPath = join(root, relPath);
    if (!existsSync(localPath)) {
      console.log(`Local file missing: ${relPath}`);
      continue;
    }

    const localVer = getFrameworkVersionFromText(readFileSync(localPath, "utf8"));

    const { status, stdout, stderr: gitErr } = runGit(["show", `${ref}:${relPath}`], root);
    if (status !== 0) {
      // A file present locally but missing from the upstream ref means
      // it was renamed or deleted upstream; any other git failure means
      // the comparison is incomplete. Either way, never report a clean
      // '[OK]' while silently skipping the file.
      if (gitErr.includes("does not exist") || gitErr.includes("exists on disk, but not in")) {
        missingUpstream.push(relPath);
      } else {
        errors.push(`Failed to read upstream version of ${relPath}: ${gitErr.trim()}`);
      }
      continue;
    }

    const upstreamVer = getFrameworkVersionFromText(stdout);

    if (!localVer) {
      errors.push(`Local file ${relPath} is missing 'framework_version' in frontmatter.`);
      continue;
    }
    if (!upstreamVer) continue;

    if (cmp(parseSemver(upstreamVer), parseSemver(localVer)) > 0) {
      updatesAvailable.push({
        filename: basename(relPath),
        local: localVer,
        upstream: upstreamVer,
        path: relPath,
      });
    }
  }

  if (errors.length) {
    console.log("Configuration errors:");
    for (const err of errors) console.log(`  - ${err}`);
    console.log();
  }

  if (missingUpstream.length) {
    console.log(
      "Files present locally but missing from the upstream ref (possibly renamed or deleted upstream):",
    );
    for (const path of missingUpstream) console.log(`  - ${path}`);
    console.log();
  }

  if (updatesAvailable.length) {
    console.log("[UPDATE] Upstream updates available for framework methodology files:");
    for (const up of updatesAvailable) {
      console.log(`  - ${up.filename}: local ${up.local} < upstream ${up.upstream}`);
      console.log(`    Diff command: git diff ${ref} -- ${up.path}`);
      console.log();
    }
    console.log("Review these changes to see if they fit your personalized fork!");
  } else if (errors.length || missingUpstream.length) {
    console.log(
      `[WARNING] Framework check incomplete against ${ref}: ` +
        `${errors.length} configuration error(s), ${missingUpstream.length} file(s) missing upstream. ` +
        "Review the messages above before assuming you are up to date.",
    );
  } else {
    console.log(`[OK] All framework files are up to date with ${ref}!`);
  }
  // Version stamps answer "which of my files changed"; commit-level triage
  // answers "which upstream commits deserve review". Point at the companion.
  console.log(
    `\nFor commit-level triage of upstream commits, run: ` +
      `python3 tools/upstream_triage.py --remote ${remote}`,
  );
  return 0;
}
