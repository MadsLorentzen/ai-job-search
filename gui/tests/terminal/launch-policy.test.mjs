import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildInteractiveClaudeArgs, claudeSpawnPlan } from "../../claude.mjs";
import { createClaudePty, RESIZE_BOUNDS } from "../../terminal/claude-pty.mjs";

function fakeSpawn(calls) {
  return (file, args, options) => {
    calls.push({ file, args, options });
    return {
      write() {},
      resize() {},
      kill() {},
      on() {},
    };
  };
}

test("PTY launch uses only the resolved Claude executable and workspace cwd", () => {
  const calls = [];
  const pty = createClaudePty({
    workspace: "C:/jobs",
    sessionId: "sess-1",
    permissionMode: "safe",
    resolveClaude: () => "C:/claude.exe",
    spawnPlan: () => ({ file: "C:/claude.exe", prefixArgs: [], shell: false }),
    spawnPty: fakeSpawn(calls),
  });
  const started = pty.start();
  assert.equal(started.file, "C:/claude.exe");
  assert.equal(started.cwd, "C:/jobs");
  assert.deepEqual(calls[0].args, buildInteractiveClaudeArgs({ sessionId: "sess-1", permissionMode: "safe" }));
  assert.equal(calls[0].args.includes("--dangerously-skip-permissions"), false);
});

test("Autonomous adds bypass and Safe never does", () => {
  const calls = [];
  createClaudePty({
    workspace: "/ws",
    sessionId: "sess-1",
    permissionMode: "autonomous",
    resolveClaude: () => "/usr/bin/claude",
    spawnPlan: () => ({ file: "/usr/bin/claude", prefixArgs: [], shell: false }),
    spawnPty: fakeSpawn(calls),
  }).start();
  assert.ok(calls[0].args.includes("--dangerously-skip-permissions"));
});

test("opaque Windows shell fallback is rejected", () => {
  const pty = createClaudePty({
    workspace: "/ws",
    sessionId: "sess-1",
    resolveClaude: () => "C:/claude.cmd",
    spawnPlan: (command) => claudeSpawnPlan(command, "win32"),
    spawnPty: fakeSpawn([]),
  });
  assert.throws(() => pty.start(), /opaque-shell-fallback/);
});

test("missing session, duplicate start, resize bounds, and dispose are enforced", () => {
  const resizes = [];
  const pty = createClaudePty({
    workspace: "/ws",
    sessionId: "sess-1",
    resolveClaude: () => "/usr/bin/claude",
    spawnPlan: () => ({ file: "/usr/bin/claude", prefixArgs: [], shell: false }),
    spawnPty: () => ({
      write() {},
      resize(cols, rows) { resizes.push({ cols, rows }); },
      kill() {},
      on() {},
    }),
  });
  assert.throws(() => createClaudePty({ workspace: "/ws", spawnPty: fakeSpawn([]) }).start(), /session-id-required/);
  pty.start();
  assert.throws(() => pty.start(), /already-started/);
  const sized = pty.resize(9999, 1);
  assert.equal(sized.cols, RESIZE_BOUNDS.maxCols);
  assert.equal(sized.rows, RESIZE_BOUNDS.minRows);
  assert.equal(pty.dispose().ok, true);
  assert.equal(pty.dispose().idempotent, true);
});

test("renderer cannot supply executable, args, env, or path", () => {
  const source = createClaudePty.toString();
  assert.match(source, /resolveClaude/);
  assert.equal(source.includes("options.file"), false);
  assert.equal(source.includes("options.args"), false);
  assert.equal(source.includes("options.env"), false);

  const preload = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "preload.cjs"), "utf8");
  assert.match(preload, /terminal/);
  assert.equal(preload.includes("spawn"), false);
  assert.equal(preload.includes("execFile"), false);
});
