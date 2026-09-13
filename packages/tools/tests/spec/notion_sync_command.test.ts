/** Guards for the /notion-sync command spec. Port of
 * tests/test_notion_sync_command.py. */
import { describe, expect, test } from "bun:test";
import { REPO, WORKFLOWS, read } from "./helpers.ts";

const COMMAND = `${WORKFLOWS}/notion-sync.md`;
const GITIGNORE = `${REPO}/.gitignore`;

describe("/notion-sync command spec", () => {
  test("command file exists with lint-compliant header", () => {
    expect(read(COMMAND).split("\n")[0]).toMatch(/^# \/notion-sync/);
  });

  test("command file is substantive", () => {
    const text = read(COMMAND);
    for (const s of ["## Step 0", "## Step 4", "## Important Rules"]) {
      expect(text).toContain(s);
    }
  });

  test("personal sync state is gitignored", () => {
    expect(read(GITIGNORE)).toContain("job_scraper/notion_sync.json");
  });

  test("privacy rule documents never sync", () => {
    expect(read(COMMAND)).toContain("never upload, attach, or embed");
  });
});
