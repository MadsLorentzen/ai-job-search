import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { templateArchiveRoot, templateArchiveUrl } from "../defaults.mjs";
import {
  defaultBrowseDir,
  existingWorkspaceHint,
  findExistingWorkspaces,
  gitSearchDirs,
  hasBinary,
  openFolderHint,
  readSharedWorkspace,
  rememberWorkspace,
  resolveGit,
  psQuote,
  resolveWorkspace,
  sameWorkspace,
  sharedWorkspacePath,
  windowsCliLaunch,
  workspaceLocationPlan,
} from "../workspace.mjs";

test("sameWorkspace treats Windows paths as the same folder", () => {
  const root = join("C:", "Users", "benja", "Documents", "GitHub", "ai-job-search");
  assert.equal(sameWorkspace(root, root), true);
  if (process.platform === "win32") {
    assert.equal(sameWorkspace(root, root.toUpperCase()), true);
  }
  assert.equal(sameWorkspace(root, join(root, "other")), false);
});

test("template archive points at the public master zip", () => {
  assert.equal(
    templateArchiveUrl("https://github.com/iLevyTate/ai-job-search.git"),
    "https://github.com/iLevyTate/ai-job-search/archive/refs/heads/master.zip",
  );
  assert.equal(templateArchiveRoot("https://github.com/iLevyTate/ai-job-search.git"), "ai-job-search-master");
});

test("gitSearchDirs includes Git for Windows", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows Git install locations");
    return;
  }
  const dirs = gitSearchDirs({
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
  });
  assert.ok(dirs.some((dir) => dir.includes(join("Git", "cmd"))));
});

test("defaultBrowseDir prefers Documents/GitHub when it exists", () => {
  const home = mkdtempSync(join(tmpdir(), "desk-home-"));
  mkdirSync(join(home, "Documents", "GitHub"), { recursive: true });
  assert.equal(defaultBrowseDir(home, "win32"), join(home, "Documents", "GitHub"));
  assert.match(existingWorkspaceHint(home, "win32"), /Windows/);
  assert.match(openFolderHint(home, "win32"), /GitHub/);
});

test("each OS build names its own usual folders", () => {
  const home = join(tmpdir(), "desk-plan-home");
  const windows = workspaceLocationPlan("win32", home);
  assert.ok(windows.parents.some((item) => item.label.includes("GitHub")));
  assert.ok(windows.parents.some((item) => item.label.includes("repos")));
  assert.match(existingWorkspaceHint(home, "win32"), /source/);

  const mac = workspaceLocationPlan("darwin", home);
  assert.ok(mac.parents.some((item) => item.label === "Developer"));
  assert.match(existingWorkspaceHint(home, "darwin"), /macOS/);
  assert.match(existingWorkspaceHint(home, "darwin"), /Developer/);

  const linux = workspaceLocationPlan("linux", home);
  assert.ok(linux.parents.some((item) => item.label === "src"));
  assert.match(existingWorkspaceHint(home, "linux"), /Linux/);
  assert.match(existingWorkspaceHint(home, "linux"), /\bsrc\b/);
});

test("Linux build honors XDG document folders", () => {
  const home = mkdtempSync(join(tmpdir(), "desk-xdg-"));
  const docs = join(home, "xdg-docs");
  mkdirSync(docs);
  assert.equal(defaultBrowseDir(home, "linux", { XDG_DOCUMENTS_DIR: docs }), docs);
});

test("findExistingWorkspaces finds a clone under Documents/GitHub", () => {
  const home = mkdtempSync(join(tmpdir(), "desk-home-"));
  const root = join(home, "Documents", "GitHub", "ai-job-search");
  mkdirSync(join(root, "gui"), { recursive: true });
  writeFileSync(join(root, "gui", "server.mjs"), "");
  writeFileSync(join(root, "AGENTS.md"), "#");
  const found = findExistingWorkspaces(home, "win32");
  assert.equal(found.length, 1);
  assert.equal(found[0].root, root);
  assert.equal(found[0].name, "ai-job-search");
});

test("macOS build finds a clone under Developer", () => {
  const home = mkdtempSync(join(tmpdir(), "desk-mac-"));
  const root = join(home, "Developer", "ai-job-search");
  mkdirSync(join(root, "gui"), { recursive: true });
  writeFileSync(join(root, "gui", "server.mjs"), "");
  writeFileSync(join(root, "AGENTS.md"), "#");
  const found = findExistingWorkspaces(home, "darwin");
  assert.equal(found.length, 1);
  assert.equal(found[0].root, root);
});

test("CLI and Desk remember the same workspace pointer", () => {
  const home = mkdtempSync(join(tmpdir(), "desk-share-"));
  const appdata = join(home, "AppData", "Roaming");
  mkdirSync(appdata, { recursive: true });
  const root = join(home, "work", "ai-job-search");
  mkdirSync(join(root, "gui"), { recursive: true });
  writeFileSync(join(root, "gui", "server.mjs"), "");
  writeFileSync(join(root, "AGENTS.md"), "#");
  const env = { APPDATA: appdata };
  rememberWorkspace(root, home, "win32", env);
  assert.equal(readSharedWorkspace(home, "win32", env), root);
  assert.equal(resolveWorkspace({ home, platform: "win32", env }), root);
  assert.match(sharedWorkspacePath(home, "win32", env), /ai-job-search/);
});

test("resolveWorkspace prefers JOB_SEARCH_ROOT over the shared pointer", () => {
  const home = mkdtempSync(join(tmpdir(), "desk-env-"));
  const appdata = join(home, "AppData", "Roaming");
  mkdirSync(appdata, { recursive: true });
  const saved = join(home, "saved", "ai-job-search");
  const envRoot = join(home, "env", "ai-job-search");
  for (const root of [saved, envRoot]) {
    mkdirSync(join(root, "gui"), { recursive: true });
    writeFileSync(join(root, "gui", "server.mjs"), "");
    writeFileSync(join(root, "AGENTS.md"), "#");
  }
  const env = { APPDATA: appdata, JOB_SEARCH_ROOT: envRoot };
  rememberWorkspace(saved, home, "win32", env);
  assert.equal(resolveWorkspace({ home, platform: "win32", env }), envRoot);
});

test("macOS and Linux builds keep the pointer in their own config dirs", () => {
  const home = join(tmpdir(), "desk-config-home");
  assert.match(sharedWorkspacePath(home, "darwin", {}), /Application Support/);
  assert.match(sharedWorkspacePath(home, "linux", {}), /\.config/);
  assert.match(sharedWorkspacePath(home, "linux", { XDG_CONFIG_HOME: join(home, "xdg") }), /xdg/);
});

test("Linux build finds a clone under src", () => {
  const home = mkdtempSync(join(tmpdir(), "desk-linux-"));
  const root = join(home, "src", "ai-job-search");
  mkdirSync(join(root, "gui"), { recursive: true });
  writeFileSync(join(root, "gui", "server.mjs"), "");
  writeFileSync(join(root, "AGENTS.md"), "#");
  const found = findExistingWorkspaces(home, "linux");
  assert.equal(found.length, 1);
  assert.equal(found[0].root, root);
});

test("windowsCliLaunch never pre-quotes the command", () => {
  // Node quotes spawn args itself; embedded quotes become \" which cmd.exe cannot parse.
  const cmd = "C:\\Users\\Jane Smith\\AppData\\Roaming\\npm\\claude.cmd";
  assert.equal(windowsCliLaunch(cmd, true), cmd);
  assert.ok(!windowsCliLaunch(cmd, true).includes('"'));
  assert.match(windowsCliLaunch(cmd, false), /^echo /);
});

test("hasBinary detects PATH commands before spawning them", () => {
  // spawn() reports a missing binary via an async error event, not a throw,
  // so the Linux terminal loop must probe first instead of trusting try/catch.
  assert.equal(hasBinary("node"), true);
  assert.equal(hasBinary("desk-no-such-terminal-xyz"), false);
});

test("psQuote makes a path safe inside a PowerShell command", () => {
  assert.equal(psQuote("C:\\Temp\\a.zip"), "'C:\\Temp\\a.zip'");
  assert.equal(psQuote("C:\\Us$er's\\a.zip"), "'C:\\Us$er''s\\a.zip'");
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
