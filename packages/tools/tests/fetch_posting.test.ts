/** Tests for fetch-posting: knap template rendering, CLI contract, snapshot rules. */
import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { renderPosting, fetchPostingMain } from "../src/fetch_posting.ts";

const REPO = new URL("../../..", import.meta.url).pathname;
const CLI = join(REPO, "packages/tools/src/cli.ts");
const TEMPLATE = join(REPO, "_templates/posting.md");
const tmp = mkdtempSync(join(tmpdir(), "fetch-posting-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Stub runner factory: succeeds with fixed stdout, or fails with a status. */
function runner(stdout: string, status = 0) {
  return ((_cmd: string, _args: string[], _o: object) => ({
    status,
    stdout,
    stderr: "",
  })) as unknown as typeof spawnSync;
}

describe("renderPosting", () => {
  const o = { company: "Acme", title: "ML Engineer", url: "https://acme.example/j", portal: "linkedin" };

  test("defuddle json feeds the knap template", () => {
    const calls: string[][] = [];
    const knap = (cmd: string, args: string[]) => {
      calls.push(args);
      return { status: 0, stdout: "---\njob_key: acme_ml-engineer\n---\n\n# ML Engineer\n", stderr: "" };
    };
    const md = renderPosting(o, "acme_ml-engineer", {
      defuddle: runner(JSON.stringify({ title: "ML Engineer", content: "body" })),
      knap: knap as unknown as typeof spawnSync,
    });
    expect(md).toContain("job_key: acme_ml-engineer");
    // knap got the template + data file + job_key/company/portal sets
    expect(calls[0]!.join(" ")).toContain("posting.md");
    expect(calls[0]!.join(" ")).toContain("job_key=acme_ml-engineer");
    expect(calls[0]!.join(" ")).toContain("portal=linkedin");
  });

  test("defuddle failure returns null", () => {
    expect(renderPosting(o, "k", { defuddle: runner("", 1) })).toBeNull();
  });

  test("knap failure returns null", () => {
    expect(
      renderPosting(o, "k", {
        defuddle: runner("{}"),
        knap: runner("", 1),
      }),
    ).toBeNull();
  });

  test("real template renders against fixture data (knap installed)", () => {
    const md = renderPosting(
      { company: "Acme", title: "", url: "https://e.com/j" },
      "acme",
      { defuddle: runner(JSON.stringify({ title: "Staff Engineer", content: "body text" })) },
    );
    expect(md).toContain("# Staff Engineer");
    expect(md).toContain("job_key: acme");
  });
});

describe("cli", () => {
  test("missing flags exit 2 with usage", () => {
    expect(fetchPostingMain(["--company", "x"])).toBe(2);
  });

  test("refuses to overwrite an existing snapshot (offline)", () => {
    const out = join(tmp, "snap.md");
    writeFileSync(out, "seed");
    const args = [
      "https://x.example/j",
      "--company",
      "Acme",
      "--title",
      "ML Engineer",
      "--out",
      out,
    ];
    const r = spawnSync("bun", ["run", CLI, "fetch-posting", ...args], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("already exists");
    expect(readFileSync(out, "utf8")).toBe("seed");
  });

  test("template file exists at the path the tool renders", () => {
    expect(existsSync(TEMPLATE)).toBe(true);
  });
});
