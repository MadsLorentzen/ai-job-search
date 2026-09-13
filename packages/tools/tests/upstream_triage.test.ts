/** Tests for upstream_triage — real git fixtures, fully offline. */
import { beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upstreamTriageMain } from "../src/upstream_triage.ts";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const UPSTREAM_SLUG = "MadsLorentzen/ai-job-search";

let root: string;

function git(...args: string[]): string {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args[0]} failed: ${res.stderr}`);
  return res.stdout ?? "";
}

function write(rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function commit(msg: string): string {
  git("add", "-A");
  git("commit", "-m", msg);
  return git("rev-parse", "HEAD").trim();
}

function setUpstreamToHead(): void {
  git("update-ref", "refs/remotes/upstream/master", "HEAD");
}

function runTriage(...args: string[]): { code: number; out: string; err: string } {
  const lines: string[] = [];
  const errLines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  console.error = (...a: unknown[]) => errLines.push(a.join(" "));
  let code: number;
  try {
    code = upstreamTriageMain(args, root);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { code, out: lines.join("\n"), err: errLines.join("\n") };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "upstream-triage-"));
  mkdirSync(join(root, ".github"));
  git("init", "-b", "master");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("remote", "add", "upstream", `https://github.com/${UPSTREAM_SLUG}.git`);
  write("shared.txt", "base\n");
  write("kept.py", "print('hi')\n");
  commit("init");
});

describe("up to date", () => {
  test("reports up to date when not behind", () => {
    setUpstreamToHead();
    const r = runTriage();
    expect(r.code).toBe(0);
    expect(r.out).toContain("Up to date");
  });
});

describe("relevance filter", () => {
  test("commit touching only removed files is skipped", () => {
    write("portals/removed_portal.py", "x = 1\n");
    commit("upstream: add removed_portal");
    setUpstreamToHead();
    git("reset", "--hard", "HEAD~1");

    const r = runTriage();
    expect(r.code).toBe(0);
    expect(r.out).toContain("touches only files not in this fork");
    expect(r.out).toContain("Probably skip");
  });

  test("commit touching kept files is worth reviewing", () => {
    write("kept.py", "print('changed')\n");
    commit("upstream: change kept.py");
    setUpstreamToHead();
    git("reset", "--hard", "HEAD~1");

    const r = runTriage();
    expect(r.code).toBe(0);
    expect(r.out).toContain("Worth reviewing");
    expect(r.out).toContain("kept.py");
    expect(r.out).toContain("git cherry-pick");
  });

  test("changelog-only footprint is skipped", () => {
    write("portals/gone.py", "y = 2\n");
    write("CHANGELOG.md", "- did a thing\n");
    commit("upstream: feature living in removed area + changelog");
    setUpstreamToHead();
    git("reset", "--hard", "HEAD~1");
    write("CHANGELOG.md", "- fork changelog\n");
    commit("fork changelog");

    const r = runTriage();
    expect(r.code).toBe(0);
    expect(r.out).toContain("changelog-only footprint in this fork");
  });
});

describe("already applied", () => {
  test("cherry-picked commit drops off via patch id", () => {
    write("kept.py", "print('feature')\n");
    const upstreamSha = commit("upstream: add feature");
    write("shared.txt", "upstream edit\n");
    commit("upstream: unrelated change");
    setUpstreamToHead();

    git("reset", "--hard", "HEAD~2");
    write("fork_only.txt", "mine\n");
    commit("fork: divergent commit");
    git("cherry-pick", upstreamSha);

    const r = runTriage();
    expect(r.code).toBe(0);
    expect(r.out).toContain("already applied (cherry-picked)");
    expect(r.out).toContain("**1** worth reviewing");
  });
});

describe("wont-port list", () => {
  test("listed sha is excluded", () => {
    write("kept.py", "print('rejected feature')\n");
    const rejected = commit("upstream: feature the fork rejects");
    setUpstreamToHead();
    git("reset", "--hard", "HEAD~1");
    write(".github/upstream-wontport.txt", `${rejected.slice(0, 9)}  # rejected on purpose\n`);
    commit("fork: won't-port list");

    const r = runTriage();
    expect(r.code).toBe(0);
    expect(r.out).toContain("on the fork's won't-port list");
  });
});

describe("missing upstream ref", () => {
  test("degrades gracefully", () => {
    const r = runTriage();
    expect(r.code).toBe(0);
    expect(r.out).toContain("was not available");
  });
});

describe("workflow guard (upstream-watch.yml)", () => {
  const workflow = () =>
    readFileSync(join(REPO_ROOT, ".github/workflows/upstream-watch.yml"), "utf8");

  test("workflow is guarded against upstream", () => {
    expect(workflow()).toContain(`github.repository != '${UPSTREAM_SLUG}'`);
  });

  test("workflow uses builtin token only", () => {
    const text = workflow();
    expect(text).toContain("GH_TOKEN: ${{ github.token }}");
    expect(text).not.toContain("secrets.");
  });

  test("actions are sha pinned", () => {
    for (const line of workflow().split("\n")) {
      const stripped = line.trim();
      if (stripped.startsWith("- uses:") || stripped.startsWith("uses:")) {
        const ref = stripped.split("uses:")[1]!.trim();
        expect(ref).toContain("@");
        const sha = ref.split("@")[1]!.split(/\s+/)[0]!;
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});
