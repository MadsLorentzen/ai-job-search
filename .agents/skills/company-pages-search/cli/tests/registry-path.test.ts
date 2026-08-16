import { describe, test, expect } from "bun:test";
import path from "node:path";
import { resolveSkillDir } from "../src/helpers";

// Regression pin for the Windows path bug: using `new URL(...).pathname` instead
// of `fileURLToPath` yields "/C:/Users/..." on Windows, and path.win32.resolve
// then produces "C:\\C:\\Users\\...", so every command ENOENTs on the registry.
// Both behaviours are asserted here so the fix cannot be quietly reverted.

const WIN_URL = "file:///C:/Users/kevin/ai-job-search/.agents/skills/company-pages-search/cli/src/";
const POSIX_URL = "file:///home/kevin/ai-job-search/.agents/skills/company-pages-search/cli/src/";

/** Stands in for node's fileURLToPath on a Windows host. */
const winToPath = (u: URL): string =>
  decodeURIComponent(u.pathname).replace(/^\//, "").replace(/\//g, "\\");

/** The bug: pathname keeps the leading slash before the drive letter. */
const buggyToPath = (u: URL): string => decodeURIComponent(u.pathname);

describe("resolveSkillDir on Windows", () => {
  test("produces a single drive-rooted path", () => {
    const dir = resolveSkillDir(WIN_URL, winToPath, path.win32);
    expect(dir).toBe("C:\\Users\\kevin\\ai-job-search\\.agents\\skills\\company-pages-search");
  });

  test("does not double the drive letter", () => {
    const dir = resolveSkillDir(WIN_URL, winToPath, path.win32);
    expect(dir).not.toMatch(/C:\\+C:/);
    expect(dir.match(/C:/g)).toHaveLength(1);
  });

  test("the pathname approach keeps the drive letter as a path segment — the bug this pins", () => {
    // path.win32 on a POSIX host has no current drive, so it emits "\C:\Users\…".
    // On a real Windows host the same input resolves against the current drive
    // and becomes "C:\C:\Users\…". Either way the drive letter has become a
    // directory name under the root, and the registry path does not exist.
    const dir = resolveSkillDir(WIN_URL, buggyToPath, path.win32);
    expect(dir).toMatch(/^[\\/]C:[\\/]/);
    expect(dir).not.toBe(resolveSkillDir(WIN_URL, winToPath, path.win32));
  });

  test("a space in the user's home is decoded, not left as %20", () => {
    const url = "file:///C:/Users/kevin%20b/repo/.agents/skills/company-pages-search/cli/src/";
    const dir = resolveSkillDir(url, winToPath, path.win32);
    expect(dir).toBe("C:\\Users\\kevin b\\repo\\.agents\\skills\\company-pages-search");
  });
});

describe("resolveSkillDir on POSIX", () => {
  test("resolves two levels up from cli/src to the skill directory", () => {
    const dir = resolveSkillDir(POSIX_URL, (u) => decodeURIComponent(u.pathname), path.posix);
    expect(dir).toBe("/home/kevin/ai-job-search/.agents/skills/company-pages-search");
  });

  test("the real module resolves to a directory named company-pages-search", () => {
    expect(path.basename(resolveSkillDir(import.meta.url + "/../../src/"))).toBe("company-pages-search");
  });
});
