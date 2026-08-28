import assert from "node:assert/strict";
import test from "node:test";
import { createClaudePty } from "../../terminal/claude-pty.mjs";

test("PTY normalizes data and exit events from an injected process", async () => {
  const handlers = {};
  const written = [];
  const pty = createClaudePty({
    workspace: "/ws",
    sessionId: "sess-1",
    createId: () => "term-1",
    resolveClaude: () => "/usr/bin/claude",
    spawnPlan: () => ({ file: "/usr/bin/claude", prefixArgs: [], shell: false }),
    spawnPty: () => ({
      write(data) { written.push(data); },
      resize() {},
      kill() {},
      on(event, listener) { handlers[event] = listener; },
    }),
  });
  const chunks = [];
  const exits = [];
  pty.onData((chunk) => chunks.push(chunk));
  pty.onExit((info) => exits.push(info));
  pty.start();
  handlers.data("hello");
  handlers.exit(0);
  pty.write("abc");
  assert.deepEqual(chunks, ["hello"]);
  assert.deepEqual(exits, [{ code: 0 }]);
  assert.deepEqual(written, ["abc"]);
  assert.throws(() => pty.write("x".repeat(9000)), /write-too-large/);
});
