import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { templateArchiveRoot, templateArchiveUrl } from "../defaults.mjs";
import { gitSearchDirs, resolveGit } from "../workspace.mjs";

test("template archive points at the public master zip", () => {
  assert.equal(
    templateArchiveUrl("https://github.com/iLevyTate/ai-job-search.git"),
    "https://github.com/iLevyTate/ai-job-search/archive/refs/heads/master.zip",
  );
  assert.equal(templateArchiveRoot("https://github.com/iLevyTate/ai-job-search.git"), "ai-job-search-master");
});

test("gitSearchDirs includes Git for Windows", () => {
  const dirs = gitSearchDirs({
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
  });
  assert.ok(dirs.some((dir) => dir.includes(join("Git", "cmd"))));
});

test("resolveGit finds git.exe in a search dir when PATH is empty", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows git shims");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "desk-git-"));
  const cmd = join(root, "Git", "cmd");
  mkdirSync(cmd, { recursive: true });
  writeFileSync(join(cmd, "git.exe"), "");
  const found = resolveGit({
    ProgramFiles: root,
    PATH: "C:\\Windows\\system32",
    SystemRoot: "C:\\Windows",
  });
  assert.equal(found, join(cmd, "git.exe"));
});
