/** Tests for /html-report and its gitignore rule. Port of
 * tests/test_html_report_command.py (lint integration replaced by the bun
 * lint-skills CLI). */
import { describe, expect, test } from "bun:test";
import { REPO, WORKFLOWS, read, section } from "./helpers.ts";
import { runCli } from "../helpers.ts";

const COMMAND_FILE = `${WORKFLOWS}/html-report.md`;
const APPLY = `${WORKFLOWS}/03-apply.md`;

describe("/html-report command file", () => {
  test("exists and starts with the correct header", () => {
    expect(read(COMMAND_FILE).trimStart().split("\n")[0]).toMatch(/^# \/html-report/);
  });

  test("is non-empty", () => {
    expect(read(COMMAND_FILE).trim().length).toBeGreaterThan(100);
  });
});

describe("tracker field coverage", () => {
  const CANONICAL_HEADER = (/^\s*(date,company,[a-z_,]+)$/m.exec(read(APPLY))![1]!).split(",");

  test("step1 parses every canonical tracker column", () => {
    const text = read(COMMAND_FILE);
    const match = /Parse every row into a record with fields:\n\s+((?:`[^`]+`,?\s*)+)/.exec(text);
    expect(match).not.toBeNull();
    const fields = [...match![1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim());
    expect(fields).toEqual(CANONICAL_HEADER);
  });

  test("step3 table columns include deadline after date", () => {
    const text = read(COMMAND_FILE);
    const match = /### Table: columns to include\n\n(.+)\n/.exec(text);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("`Date` · `Deadline` · `Company`");
  });
});

describe("stats semantics", () => {
  test("funnel is computed from stage history, not current status", () => {
    const text = read(COMMAND_FILE);
    const step2 = text.split("## Step 3")[0]!.split("## Step 2")[1]!;
    expect(step2).toContain("stage checkboxes");
    expect(text).toContain("not current status");
  });

  test("rejection rate excludes declined offers and withdrawals", () => {
    const text = read(COMMAND_FILE);
    const step2 = text.split("## Step 3")[0]!.split("## Step 2")[1]!;
    expect(step2).toContain("`offer_declined`");
    expect(text).toContain("not rejections");
  });

  test("reports folder is gitignored", () => {
    const rules = new Set(
      read(`${REPO}/.gitignore`).split("\n").map((l) => l.trim()),
    );
    expect(rules.has("reports/")).toBe(true);
  });
});

describe("lint integration", () => {
  test("lint-skills passes on the real repo", () => {
    const r = runCli(["lint-skills"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("OK");
  });
});
