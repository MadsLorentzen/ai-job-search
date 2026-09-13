/**
 * Guards for check_framework_version — the CI gate itself.
 *
 * This gate is what stops a PR from editing a profile-bearing framework
 * file without bumping `framework_version` (the fork-rebase safety marker).
 * A broken guard is silent by construction: nothing fails, it just stops
 * catching (review finding F22, 2026-08-19).
 *
 * Each test builds an isolated git repo (the checker takes an explicit
 * root), so the real repo is never read or written.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameworkVersionMain } from "../src/check_framework_version.ts";

const FRONTMATTER = "---\nframework_version: 1.0.0\n---\n";
const BODY = "# Test framework file\n\nOriginal guidance sentence.\n";

let root: string;
let frameworkFile: string;
let savedGithubEnv: Record<string, string | undefined> = {};

function git(...args: string[]): void {
  const res = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { cwd: root, encoding: "utf8" },
  );
  if (res.status !== 0) throw new Error(`git ${args[0]} failed: ${res.stderr}`);
}

function runChecker(): { code: number; out: string } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  let code: number;
  try {
    code = frameworkVersionMain([], root);
  } finally {
    console.log = original;
  }
  return { code, out: lines.join("\n") };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fw-version-"));
  const skillDir = join(root, ".pi-agent", "skills", "job-application-assistant");
  mkdirSync(skillDir, { recursive: true });
  frameworkFile = join(skillDir, "01-test-profile.md");
  writeFileSync(frameworkFile, FRONTMATTER + BODY, "utf8");

  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "base");

  // Strip GitHub Actions variables so getBaseCommit() takes the local path
  // (uncommitted changes vs HEAD) regardless of where the suite runs.
  savedGithubEnv = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GITHUB_")) {
      savedGithubEnv[key] = process.env[key];
      delete process.env[key];
    }
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedGithubEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("framework version gate", () => {
  test("clean tree passes", () => {
    const result = runChecker();
    expect(result.code).toBe(0);
    expect(result.out).toContain("Framework Version Check: OK");
  });

  test("unbumped edit fails", () => {
    writeFileSync(
      frameworkFile,
      FRONTMATTER + BODY + "\nA new sentence without a version bump.\n",
      "utf8",
    );
    const result = runChecker();
    expect(result.code).toBe(1);
    expect(result.out).toContain("modified without bumping 'framework_version'");
  });

  test("bumped edit passes", () => {
    const bumped = FRONTMATTER.replace("1.0.0", "1.0.1");
    writeFileSync(
      frameworkFile,
      bumped + BODY + "\nA new sentence with a version bump.\n",
      "utf8",
    );
    const result = runChecker();
    expect(result.code).toBe(0);
  });

  test("file without version marker fails", () => {
    writeFileSync(
      join(root, ".pi-agent", "skills", "job-application-assistant", "02-unmarked.md"),
      "# No frontmatter at all\n",
      "utf8",
    );
    const result = runChecker();
    expect(result.code).toBe(1);
    expect(result.out).toContain("missing 'framework_version'");
  });
});
