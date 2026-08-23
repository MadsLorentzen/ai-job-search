import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  commandLooksInstalled,
  extractHttpsUrls,
  isJobSearchWorkspace,
  loginNeedsCode,
  loginSucceeded,
  parseAuthStatus,
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
