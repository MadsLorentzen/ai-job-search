import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildClaudeArgs,
  chromeEnabled,
  commandLooksInstalled,
  extractHttpsUrls,
  isJobSearchWorkspace,
  loadDeskSession,
  loginNeedsCode,
  loginSucceeded,
  needsInstall,
  needsLogin,
  parseAuthStatus,
  saveDeskSession,
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

test("buildClaudeArgs keeps Chrome and one named session", () => {
  const first = buildClaudeArgs("/scrape", { chrome: true });
  assert.equal(first[0], "--chrome");
  assert.ok(first.includes("--name"));
  assert.ok(first.includes("Job Search Desk"));
  assert.equal(first.includes("--resume"), false);

  const again = buildClaudeArgs("/apply", { sessionId: "abc-123", chrome: true });
  assert.deepEqual(again.slice(-2), ["--resume", "abc-123"]);
  assert.equal(chromeEnabled({ JOB_SEARCH_CLAUDE_CHROME: "0" }), false);
  assert.equal(chromeEnabled({}), true);
});

test("desk session persists the same id", () => {
  const root = mkdtempSync(join(tmpdir(), "desk-session-"));
  assert.equal(loadDeskSession(root), null);
  saveDeskSession(root, "session-one");
  assert.equal(loadDeskSession(root), "session-one");
});
