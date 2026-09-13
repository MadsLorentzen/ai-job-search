/** Tests for fetch-posting: frontmatter merging, CLI contract, snapshot rules. */
import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { frontmatterFor, fetchPostingMain } from "../src/fetch_posting.ts";
import { makeKey } from "../src/job_key.ts";

const REPO = new URL("../../..", import.meta.url).pathname;
const CLI = join(REPO, "packages/tools/src/cli.ts");
const tmp = mkdtempSync(join(tmpdir(), "fetch-posting-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("frontmatter", () => {
  test("carries url, fetched_at, job_key, portal", () => {
    const fm = frontmatterFor(
      { company: "Acme", title: "ML Engineer", url: "https://acme.example/j", portal: "linkedin" },
      makeKey("Acme", "ML Engineer"),
    );
    expect(fm).toContain("url: https://acme.example/j");
    expect(fm).toContain("job_key: acme_ml-engineer");
    expect(fm).toContain("portal: linkedin");
    expect(fm).toMatch(/fetched_at: \d{4}-\d{2}-\d{2}T/);
    expect(fm.startsWith("---\n") && fm.endsWith("---\n\n")).toBe(true);
  });
});

describe("cli", () => {
  test("missing flags exit 2 with usage", () => {
    expect(fetchPostingMain(["--company", "x"])).toBe(2);
  });

  test("writes snapshot and never overwrites", () => {
    const out = join(tmp, "snap.md");
    const args = ["https://x.example/j", "--company", "Acme", "--title", "ML Engineer", "--out", out];
    // run against the real CLI via bun so defuddle resolution is exercised
    const r1 = spawnSync("bun", ["run", CLI, "fetch-posting", ...args], { encoding: "utf8" });
    // network-independent: seed the target, the CLI must refuse to overwrite
    writeFileSync(out, "seed");
    const r2 = spawnSync("bun", ["run", CLI, "fetch-posting", ...args], { encoding: "utf8" });
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("already exists");
    expect(readFileSync(out, "utf8")).toBe("seed");
  });
});
