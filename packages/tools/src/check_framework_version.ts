/**
 * CI check: ensure that modified framework files have updated version markers.
 *
 * Port of tools/check_framework_version.py; the framework skill dir moved to
 * .pi-agent/skills/job-application-assistant/. Fails if any markdown file
 * there is modified in git without a change/bump to its 'framework_version'
 * frontmatter key. Also ensures all framework files have a valid
 * 'framework_version' frontmatter key.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;

export function runGit(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

export function getBaseCommit(root: string): string | null {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    if (runGit(["rev-parse", "--verify", `origin/${baseRef}`], root).status === 0) {
      return `origin/${baseRef}`;
    }
    if (runGit(["rev-parse", "--verify", baseRef], root).status === 0) {
      return baseRef;
    }
  }
  // Running in GitHub Actions but not a PR (e.g. push to master)
  if (process.env.GITHUB_ACTIONS) {
    if (runGit(["rev-parse", "--verify", "HEAD~1"], root).status === 0) return "HEAD~1";
  }
  // Otherwise (running locally), check uncommitted changes against HEAD
  if (runGit(["rev-parse", "--verify", "HEAD"], root).status === 0) return "HEAD";
  return null;
}

export function parseFrontmatter(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end === -1) return {};
  const data: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx !== -1) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      data[k] = v.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    }
  }
  return data;
}

export function hasNonTrivialChanges(
  filePath: string,
  baseCommit: string,
  root: string,
): boolean {
  const relPath = filePath.startsWith(root) ? filePath.slice(root.length).replace(/^\//, "") : filePath;
  const { status, stdout } = runGit(["diff", "-U0", baseCommit, "--", relPath], root);
  if (status !== 0) {
    // If diff fails (e.g. file is new/untracked), it's a change
    return true;
  }

  let meaningfulChanges = 0;
  let versionChanged = false;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+") || line.startsWith("-")) {
      const content = line.slice(1).trim();
      if (!content) continue;
      if (/^framework_version\s*:/.test(content)) {
        versionChanged = true;
        continue;
      }
      if (content === "---") continue; // frontmatter syntax
      meaningfulChanges++;
    }
  }

  // If the version key itself was modified, we don't fail, regardless of other changes
  if (versionChanged) return false;
  return meaningfulChanges > 0;
}

export function frameworkVersionMain(_argv: string[], root: string = ROOT): number {
  const skillDir = join(root, ".pi-agent", "skills", "job-application-assistant");
  const frameworkFiles: string[] = existsSync(skillDir)
    ? readdirSync(skillDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => join(skillDir, f))
        .sort()
    : [];
  const rootAgents = join(root, "AGENTS.md");
  if (existsSync(rootAgents)) frameworkFiles.push(rootAgents);

  const errors: string[] = [];
  const rel = (p: string) => p.slice(root.length).replace(/^\//, "");

  // 1. Lint: all framework files must have framework_version in frontmatter
  for (const path of frameworkFiles) {
    const fm = parseFrontmatter(path);
    if (!("framework_version" in fm)) {
      errors.push(`${rel(path)}: missing 'framework_version' in frontmatter`);
    }
  }

  // 2. Check for missing version bumps in modified files
  const baseCommit = getBaseCommit(root);
  if (baseCommit) {
    console.log(`Comparing HEAD against base commit: ${baseCommit}`);
    for (const path of frameworkFiles) {
      if (!("framework_version" in parseFrontmatter(path))) continue; // reported above
      if (hasNonTrivialChanges(path, baseCommit, root)) {
        errors.push(
          `${rel(path)}: modified without bumping 'framework_version'. ` +
            "Please update the version in the frontmatter.",
        );
      }
    }
  } else {
    console.log(
      "No base commit found (e.g. initial commit or shallow clone without base branch). Skipping diff checks.",
    );
  }

  if (errors.length) {
    console.log("Framework Version Check Failed:");
    for (const err of errors) console.log(`  - ${err}`);
    return 1;
  }
  console.log("Framework Version Check: OK");
  return 0;
}
