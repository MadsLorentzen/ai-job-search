/** Tests for check_upstream_updates — isolated git fixtures, --no-fetch only. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upstreamUpdatesMain } from "../src/check_upstream_updates.ts";

const TEMPLATE_URL = "https://github.com/MadsLorentzen/ai-job-search.git";
const FORK_URL = "https://github.com/octocat/ai-job-search.git";

const FRAMEWORK_FILES = [
  "profile/01-candidate-profile.md",
  "profile/02-behavioral-profile.md",
  "profile/03-writing-style.md",
  "profile/04-job-evaluation.md",
  "factory/05-cv-templates.md",
  "factory/06-cover-letter-templates.md",
  "methods/07-interview-prep.md",
  "methods/08-application-forms.md",
  "profile/09-web-research.md",
  ".pi-agent/skills/job-application-assistant/SKILL.md",
  "AGENTS.md",
];

const FRONTMATTER = "---\nframework_version: 1.0.0\n---\n";

let root: string;

function git(...args: string[]): void {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args[0]} failed: ${res.stderr}`);
}

function addRemote(name: string, url: string): void {
  git("remote", "add", name, url);
}

function materializeRemoteRef(name: string): void {
  git("update-ref", `refs/remotes/${name}/master`, "HEAD");
}

function runChecker(...args: string[]): { code: number; out: string } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args2: unknown[]) => lines.push(args2.join(" "));
  let code: number;
  try {
    code = upstreamUpdatesMain(["--no-fetch", ...args], root);
  } finally {
    console.log = original;
  }
  return { code, out: lines.join("\n") };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "upstream-updates-"));
  for (const rel of FRAMEWORK_FILES) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, FRONTMATTER, "utf8");
  }
  git("init", "-b", "master");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("add", "-A");
  git("commit", "-m", "init");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("fork without upstream remote", () => {
  beforeEach(() => {
    addRemote("origin", FORK_URL);
    materializeRemoteRef("origin");
  });

  test("fork fallback warns that check is against own fork", () => {
    const result = runChecker("--remote", "upstream");
    expect(result.code).toBe(0);
    expect(result.out).toContain("Falling back to 'origin'");
    expect(result.out).toContain("does not point to the ai-job-search template repo");
    expect(result.out).not.toContain("up to date with upstream!");
    expect(result.out).toContain("up to date with origin/master");
  });
});

describe("direct clone fallback", () => {
  beforeEach(() => {
    addRemote("origin", TEMPLATE_URL);
    materializeRemoteRef("origin");
  });

  test("clone of template falls back without fork warning", () => {
    const result = runChecker("--remote", "upstream");
    expect(result.code).toBe(0);
    expect(result.out).toContain("Falling back to 'origin'");
    expect(result.out).not.toContain("does not point to the ai-job-search template repo");
    expect(result.out).toContain("up to date with origin/master");
  });

  test("clone with lowercased template url falls back without fork warning", () => {
    // GitHub serves repo paths case-insensitively, so a clone from
    // https://github.com/madslorentzen/ai-job-search is still the template.
    git("remote", "set-url", "origin", TEMPLATE_URL.toLowerCase());
    const result = runChecker("--remote", "upstream");
    expect(result.code).toBe(0);
    expect(result.out).toContain("Falling back to 'origin'");
    expect(result.out).not.toContain("does not point to the ai-job-search template repo");
  });
});

describe("upstream remote present", () => {
  beforeEach(() => {
    addRemote("origin", FORK_URL);
    addRemote("upstream", TEMPLATE_URL);
    materializeRemoteRef("upstream");
  });

  test("explicit upstream remote is used without warning", () => {
    const result = runChecker();
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("Falling back to 'origin'");
    expect(result.out).not.toContain("does not point to the ai-job-search template repo");
    expect(result.out).toContain("up to date with upstream/master");
  });
});

describe("upstream ref missing a file", () => {
  // Simulates upstream renaming/deleting one framework file while the fork
  // still has its own copy: git show then fails, and the checker used to
  // swallow the error and report a clean '[OK]'.
  beforeEach(() => {
    addRemote("origin", FORK_URL);
    addRemote("upstream", TEMPLATE_URL);

    // Upstream drops AGENTS.md (rename/delete) in a new commit.
    git("rm", "-q", "AGENTS.md");
    git("commit", "-qm", "drop AGENTS.md");
    materializeRemoteRef("upstream");

    // The fork keeps its own copy locally, so only the upstream side lacks it.
    writeFileSync(join(root, "AGENTS.md"), FRONTMATTER, "utf8");
  });

  test("file missing upstream is reported instead of silent OK", () => {
    const result = runChecker();
    expect(result.code).toBe(0);
    expect(result.out).toContain("AGENTS.md");
    expect(result.out).not.toContain("[OK] All framework files are up to date");
    expect(result.out).toContain("[WARNING]");
  });
});
