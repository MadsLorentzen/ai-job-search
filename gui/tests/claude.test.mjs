import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  buildClaudeArgs,
  buildInteractiveClaudeArgs,
  chromeEnabled,
  claudeSpawnPlan,
  closePrintInput,
  clearDeskSession,
  commandLooksInstalled,
  exitErrorText,
  extraBinDirs,
  extractHttpsUrls,
  isJobSearchWorkspace,
  loadDeskSession,
  loginNeedsCode,
  loginSucceeded,
  needsInstall,
  needsLogin,
  parseAuthStatus,
  resolveCommand,
  saveDeskSession,
  shouldRetryWithoutResume,
  turnStatusText,
  windowsShimTarget,
  withClaudePath,
} from "../claude.mjs";

test("parseAuthStatus reads a claude.ai subscription", () => {
  const status = parseAuthStatus({
    loggedIn: true,
    authMethod: "claude.ai",
    email: "user@example.com",
    subscriptionType: "max",
    orgName: "Example",
  });
  assert.equal(status.loggedIn, true);
  assert.equal(status.usesClaudeAi, true);
  assert.equal(status.email, "user@example.com");
  assert.equal(status.subscriptionType, "max");
});

test("parseAuthStatus treats logged-out JSON as signed out", () => {
  const status = parseAuthStatus('{"loggedIn":false,"authMethod":null}');
  assert.equal(status.loggedIn, false);
  assert.equal(status.usesClaudeAi, false);
  assert.equal(status.authMethod, "");
});

test("needsLogin only when Claude reports signed out", () => {
  assert.equal(needsLogin({ installed: true, loggedIn: false }), true);
  assert.equal(needsLogin({ installed: true, loggedIn: true }), false);
  assert.equal(needsLogin({ installed: true, loggedIn: false, error: "spawn ENOENT" }), false);
  assert.equal(needsLogin({ installed: true, loggedIn: null, error: "timeout" }), false);
  assert.equal(needsLogin({ installed: false, loggedIn: false }), false);
  assert.equal(needsInstall({ installed: false, loggedIn: false }), true);
  assert.equal(needsInstall({ installed: false, error: "where failed" }), false);
});

test("extractHttpsUrls keeps login links and drops trailing punctuation", () => {
  const urls = extractHttpsUrls("Open https://claude.ai/oauth/authorize?x=1.\nAlso https://claude.ai/oauth/authorize?x=1");
  assert.deepEqual(urls, ["https://claude.ai/oauth/authorize?x=1"]);
});

test("login helpers recognize the official prompts", () => {
  assert.equal(loginNeedsCode("Paste code here if prompted"), true);
  assert.equal(loginSucceeded("Login successful"), true);
  assert.equal(loginNeedsCode("Waiting"), false);
});

test("isJobSearchWorkspace requires the desk and AGENTS.md", () => {
  const root = mkdtempSync(join(tmpdir(), "desk-ws-"));
  assert.equal(isJobSearchWorkspace(root), false);
  mkdirSync(join(root, "gui"), { recursive: true });
  writeFileSync(join(root, "gui", "server.mjs"), "");
  writeFileSync(join(root, "AGENTS.md"), "#");
  assert.equal(isJobSearchWorkspace(root), true);
});

test("commandLooksInstalled rejects a bare command name", () => {
  assert.equal(commandLooksInstalled("claude"), false);
  assert.equal(commandLooksInstalled(""), false);
});

test("withClaudePath prepends extra bin dirs", () => {
  const env = withClaudePath({ PATH: "/usr/bin", HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE });
  assert.match(env.PATH, /\.local/);
});

test("withClaudePath includes the Windows npm global folder", () => {
  const env = withClaudePath({
    PATH: "C:\\Windows\\system32",
    APPDATA: "C:\\Users\\test\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
    USERPROFILE: "C:\\Users\\test",
    npm_config_prefix: "C:\\custom\\npm-prefix",
  });
  assert.match(env.PATH, /AppData[/\\]Roaming[/\\]npm/);
  assert.match(env.PATH, /AppData[/\\]Local[/\\]claude/);
  assert.match(env.PATH, /WinGet[/\\]Links/);
  assert.match(env.PATH, /custom[/\\]npm-prefix/);
});

test("extraBinDirs keeps the native installer and WinGet locations", () => {
  const dirs = extraBinDirs({
    USERPROFILE: "C:\\Users\\test",
    LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
    APPDATA: "C:\\Users\\test\\AppData\\Roaming",
  });
  assert.ok(dirs.some((dir) => dir.endsWith(join("test", ".local", "bin")) || dir.includes(".local")));
});

test("resolveCommand prefers claude.cmd over the extensionless npm shim", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows npm shims");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "desk-npm-"));
  const npm = join(root, "npm");
  mkdirSync(npm);
  writeFileSync(join(npm, "claude"), "unix shim");
  writeFileSync(join(npm, "claude.cmd"), "@echo off\r\n");
  const found = resolveCommand("claude", {
    APPDATA: root,
    PATH: "C:\\Windows\\system32",
    SystemRoot: "C:\\Windows",
    LOCALAPPDATA: join(root, "Local"),
    USERPROFILE: root,
  });
  assert.equal(realpathSync(found), realpathSync(join(npm, "claude.cmd")));
});

test("interactive Claude args resume the session and add bypass only in Autonomous", () => {
  assert.deepEqual(
    buildInteractiveClaudeArgs({ sessionId: "sess-1", permissionMode: "safe" }),
    ["--resume", "sess-1", "--name", "Job Search Desk"],
  );
  assert.ok(buildInteractiveClaudeArgs({ sessionId: "sess-1", permissionMode: "autonomous" }).includes("--dangerously-skip-permissions"));
  assert.throws(() => buildInteractiveClaudeArgs({ permissionMode: "safe" }), /session-id-required/);
});

test("buildClaudeArgs disables Chrome by default so print mode cannot wait for the extension", () => {
  const safe = buildClaudeArgs("/scrape");
  assert.equal(safe[0], "--no-chrome");
  assert.equal(chromeEnabled({}), false);
  assert.equal(chromeEnabled({ JOB_SEARCH_CLAUDE_CHROME: "1" }), true);

  const first = buildClaudeArgs("/scrape", { chrome: true });
  assert.equal(first[0], "--chrome");
  assert.ok(first.includes("--name"));
  assert.ok(first.includes("Job Search Desk"));
  assert.equal(first.includes("--resume"), false);

  const again = buildClaudeArgs("/apply", { sessionId: "abc-123", chrome: true });
  assert.deepEqual(again.slice(-2), ["--resume", "abc-123"]);
  assert.equal(chromeEnabled({ JOB_SEARCH_CLAUDE_CHROME: "0" }), false);
});

test("turnStatusText does not claim Chrome is opening when integration is disabled", () => {
  assert.equal(turnStatusText({ chrome: false, resuming: false }), "Starting Claude");
  assert.equal(turnStatusText({ chrome: false, resuming: true }), "Continuing with Claude");
  assert.match(turnStatusText({ chrome: true, resuming: false }), /Chrome group/);
});

test("closePrintInput ends the pipe so Claude print mode can start", () => {
  const input = new PassThrough();
  closePrintInput(input);
  assert.equal(input.writableEnded, true);
});

test("desk session persists the same id", () => {
  const root = mkdtempSync(join(tmpdir(), "desk-session-"));
  assert.equal(loadDeskSession(root), null);
  saveDeskSession(root, "session-one");
  assert.equal(loadDeskSession(root), "session-one");
});

function makeShim(dir, content) {
  const shim = join(dir, "claude.cmd");
  writeFileSync(shim, content);
  return shim;
}

test("windowsShimTarget resolves the npm exe shim next to the .cmd", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-shim-"));
  const bin = join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude.exe"), "");
  const shim = makeShim(
    dir,
    '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',
  );
  assert.equal(windowsShimTarget(shim), join(bin, "claude.exe"));
});

test("windowsShimTarget resolves node-script shims to the cli.js", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-shim-js-"));
  const pkg = join(dir, "node_modules", "claude-code");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "cli.js"), "");
  const shim = makeShim(dir, '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\claude-code\\cli.js" %*\r\n');
  assert.equal(windowsShimTarget(shim), join(pkg, "cli.js"));
});

test("windowsShimTarget returns empty when the target is missing or the file is not a shim", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-shim-none-"));
  const shim = makeShim(dir, '@ECHO off\r\n"%dp0%\\node_modules\\gone\\cli.js" %*\r\n');
  assert.equal(windowsShimTarget(shim), "");
  assert.equal(windowsShimTarget(join(dir, "missing.cmd")), "");
});

test("claudeSpawnPlan bypasses cmd.exe when the shim wraps a real exe", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-plan-"));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude.exe"), "");
  const shim = makeShim(dir, '"%dp0%\\bin\\claude.exe" %*\r\n');
  const plan = claudeSpawnPlan(shim, "win32");
  assert.equal(plan.file, join(bin, "claude.exe"));
  assert.deepEqual(plan.prefixArgs, []);
  assert.equal(plan.shell, false);
});

test("claudeSpawnPlan runs script shims through node without a shell", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-plan-js-"));
  const pkg = join(dir, "pkg");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "cli.js"), "");
  const shim = makeShim(dir, '"%_prog%" "%dp0%\\pkg\\cli.js" %*\r\n');
  const plan = claudeSpawnPlan(shim, "win32");
  assert.equal(plan.viaNode, true);
  assert.deepEqual(plan.prefixArgs, [join(pkg, "cli.js")]);
  assert.equal(plan.shell, false);
});

test("claudeSpawnPlan keeps shell fallback only for unresolvable .cmd wrappers", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-plan-opaque-"));
  const shim = makeShim(dir, "@ECHO off\r\nsome-custom-launcher %*\r\n");
  const plan = claudeSpawnPlan(shim, "win32");
  assert.equal(plan.file, shim);
  assert.equal(plan.shell, true);
});

test("claudeSpawnPlan leaves plain binaries untouched", () => {
  assert.deepEqual(claudeSpawnPlan("/usr/local/bin/claude", "darwin"), {
    file: "/usr/local/bin/claude",
    prefixArgs: [],
    shell: false,
  });
  assert.deepEqual(claudeSpawnPlan("C:\\Tools\\claude.exe", "win32"), {
    file: "C:\\Tools\\claude.exe",
    prefixArgs: [],
    shell: false,
  });
});

test("desk session can be cleared after it goes stale", () => {
  const root = mkdtempSync(join(tmpdir(), "desk-clear-"));
  saveDeskSession(root, "abc-123");
  assert.equal(loadDeskSession(root), "abc-123");
  clearDeskSession(root);
  assert.equal(loadDeskSession(root), null);
  clearDeskSession(root); // clearing twice stays quiet
});

test("a failed resume retries once without the stale session", () => {
  const base = { code: 1, sawInit: false, usedResume: true, retried: false };
  assert.equal(shouldRetryWithoutResume(base), true);
  assert.equal(shouldRetryWithoutResume({ ...base, code: 0 }), false);
  assert.equal(shouldRetryWithoutResume({ ...base, sawInit: true }), false);
  assert.equal(shouldRetryWithoutResume({ ...base, usedResume: false }), false);
  assert.equal(shouldRetryWithoutResume({ ...base, retried: true }), false);
});

test("exitErrorText stays silent after a requested stop", () => {
  assert.equal(exitErrorText(1, true), null);
  assert.equal(exitErrorText(0, false), null);
  assert.equal(exitErrorText(null, false), null);
  assert.match(exitErrorText(1, false), /exited with code 1/);
  assert.match(exitErrorText(-4058, false), /not installed/);
});
