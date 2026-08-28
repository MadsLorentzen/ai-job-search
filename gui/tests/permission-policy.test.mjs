import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  allowDangerouslySkipPermissions,
  createPermissionPolicy,
  normalizeDeskPermissionMode,
  permissionPolicyPath,
  sdkPermissionMode,
} from "../permission-policy.mjs";

test("Safe is the default and never maps to bypass permissions", () => {
  assert.equal(normalizeDeskPermissionMode(undefined), "safe");
  assert.equal(normalizeDeskPermissionMode("safe"), "safe");
  assert.equal(normalizeDeskPermissionMode("SAFE"), "safe");
  assert.equal(normalizeDeskPermissionMode("default"), "safe");
  assert.equal(normalizeDeskPermissionMode("bypassPermissions"), "safe");
  assert.equal(normalizeDeskPermissionMode("autonomous"), "autonomous");

  assert.equal(sdkPermissionMode("safe"), "default");
  assert.equal(sdkPermissionMode("autonomous"), "bypassPermissions");
  assert.equal(sdkPermissionMode("SAFE"), "default");
  assert.equal(sdkPermissionMode(undefined), "default");
  assert.equal(sdkPermissionMode("bypassPermissions"), "default");

  assert.equal(allowDangerouslySkipPermissions("safe"), false);
  assert.equal(allowDangerouslySkipPermissions("autonomous"), true);
  assert.equal(allowDangerouslySkipPermissions("SAFE"), false);
  assert.equal(allowDangerouslySkipPermissions(undefined), false);
});

test("preferences are workspace-scoped and persist across reloads", async () => {
  const firstWorkspace = mkdtempSync(join(tmpdir(), "desk-policy-a-"));
  const secondWorkspace = mkdtempSync(join(tmpdir(), "desk-policy-b-"));
  const first = createPermissionPolicy({ workspace: firstWorkspace });
  const second = createPermissionPolicy({ workspace: secondWorkspace });

  assert.equal(await first.load(), "safe");
  assert.equal(await second.load(), "safe");
  assert.equal(await first.set("autonomous"), "autonomous");
  assert.equal(second.get(), "safe");

  const reloaded = createPermissionPolicy({ workspace: firstWorkspace });
  assert.equal(await reloaded.load(), "autonomous");
  assert.equal(reloaded.get(), "autonomous");
  assert.match(permissionPolicyPath(firstWorkspace), /permission-policy\.json$/);
});

test("corrupt or unsupported preference files become Safe", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "desk-policy-bad-"));
  const path = permissionPolicyPath(workspace);
  mkdirSync(join(workspace, ".claude", "desk"), { recursive: true });

  writeFileSync(path, "{not-json");
  const corrupt = createPermissionPolicy({ workspace });
  assert.equal(await corrupt.load(), "safe");
  assert.equal(corrupt.get(), "safe");

  writeFileSync(path, JSON.stringify({ schemaVersion: 99, mode: "autonomous" }));
  const unsupported = createPermissionPolicy({ workspace });
  assert.equal(await unsupported.load(), "safe");

  writeFileSync(path, JSON.stringify({ schemaVersion: 1, mode: "bypassPermissions" }));
  const invalid = createPermissionPolicy({ workspace });
  assert.equal(await invalid.load(), "safe");

  await invalid.set("autonomous");
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.mode, "autonomous");
  assert.equal(saved.schemaVersion, 1);
});
