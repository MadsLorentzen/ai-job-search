/** Tests for the /expand workflow spec. Port of
 * tests/test_expand_command.py (profile/workflows/expand.md). */
import { describe, expect, test } from "bun:test";
import { WORKFLOWS, read } from "./helpers.ts";

const EXPAND = `${WORKFLOWS}/expand.md`;

describe("/expand workflow spec", () => {
  test("file exists", () => {
    expect(read(EXPAND).length).toBeGreaterThan(0);
  });

  test("starts with correct header", () => {
    expect(read(EXPAND).trimStart().split("\n")[0]).toMatch(/^# \/expand/);
  });

  test("covers all discovery sources", () => {
    const text = read(EXPAND);
    for (const src of [
      "documents/cv/",
      "documents/linkedin/",
      "documents/diplomas/",
      "documents/references/",
      "GitHub Profile",
    ]) {
      expect(text).toContain(src);
    }
  });

  test("maps github projects to independent projects section", () => {
    const text = read(EXPAND);
    expect(text).toContain("## Independent Projects");
    expect(text).toContain("Independent Projects & Portfolio");
    expect(text).toContain("GitHub — repo-name");
    expect(text).toContain("Portfolio & projects grounded in code");
    expect(text).not.toContain("documents/projects/");
  });

  test("enforces additive and confirmation principles", () => {
    const text = read(EXPAND);
    expect(text).toContain("Additive only");
    expect(text).toContain("User confirms before writing");
    expect(text).toContain("`all`");
    expect(text).toContain("`review`");
    expect(text).toContain("`skip`");
  });
});
