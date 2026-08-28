import assert from "node:assert/strict";
import test from "node:test";
import { createAgentSdkAdapter } from "../agent-sdk-adapter.mjs";
import { claudeSupportsDeskRuntime, parseClaudeVersion } from "../claude.mjs";

function fakeQuery(received) {
  return ({ prompt, options }) => {
    received.prompt = prompt;
    received.options = options;
    const messages = received.messages ?? [];
    const query = (async function* () {
      for (const item of messages) yield item;
    })();
    query.interrupt = async () => ({ type: "interrupt" });
    query.reinitialize = async () => ({ type: "init" });
    query.setPermissionMode = async (mode) => {
      received.permissionMode = mode;
    };
    query.initializationResult = async () => ({ type: "init" });
    query.close = () => {
      received.closed = (received.closed || 0) + 1;
    };
    received.query = query;
    return query;
  };
}

test("one query receives multiple user messages and the required options", async () => {
  const received = { messages: [{ type: "system", subtype: "init", session_id: "s1" }] };
  const adapter = createAgentSdkAdapter({
    cwd: "C:\\repo",
    claudeExecutable: "C:\\bin\\claude.exe",
    sessionId: "sess-1",
    permissionMode: "safe",
    queryImpl: fakeQuery(received),
  });
  await adapter.start();
  assert.equal(received.options.cwd, "C:\\repo");
  assert.equal(received.options.resume, "sess-1");
  assert.equal(received.options.pathToClaudeCodeExecutable, "C:\\bin\\claude.exe");
  assert.equal(received.options.includePartialMessages, true);
  assert.equal(received.options.includeHookEvents, true);
  assert.equal(received.options.forwardSubagentText, true);
  assert.deepEqual(received.options.settingSources, ["user", "project", "local"]);
  assert.equal(received.options.permissionMode, "default");
  assert.equal(received.options.allowDangerouslySkipPermissions, false);
  assert.equal(typeof received.options.canUseTool, "function");

  assert.deepEqual(adapter.send({ id: "m1", text: "first" }), { accepted: true });
  assert.deepEqual(adapter.send({ id: "m2", text: "second" }), { accepted: true });
  adapter.close();
  const fromPrompt = [];
  for await (const message of received.prompt) fromPrompt.push(message);
  assert.equal(fromPrompt.length, 2);
  assert.equal(fromPrompt[0].message.content, "first");
  assert.equal(fromPrompt[1].message.content, "second");
});

test("Safe mode never enables bypass permissions", async () => {
  const received = {};
  await createAgentSdkAdapter({
    cwd: ".",
    claudeExecutable: "claude",
    permissionMode: "safe",
    queryImpl: fakeQuery(received),
  }).start();
  assert.equal(received.options.allowDangerouslySkipPermissions, false);
  assert.equal(received.options.permissionMode, "default");
});

test("Autonomous mode enables bypass permissions", async () => {
  const received = {};
  await createAgentSdkAdapter({
    cwd: ".",
    claudeExecutable: "claude",
    permissionMode: "autonomous",
    queryImpl: fakeQuery(received),
  }).start();
  assert.equal(received.options.allowDangerouslySkipPermissions, true);
  assert.equal(received.options.permissionMode, "bypassPermissions");
});

test("duplicate permission callback IDs share one pending decision", async () => {
  const received = {};
  const requests = [];
  const adapter = createAgentSdkAdapter({
    cwd: ".",
    claudeExecutable: "claude",
    permissionMode: "safe",
    onPermissionRequest: (request) => {
      requests.push(request);
    },
    queryImpl: fakeQuery(received),
  });
  await adapter.start();
  const first = received.options.canUseTool("Bash", { command: "ls" }, { requestId: "req-1", toolUseID: "tool-1", signal: new AbortController().signal });
  const second = received.options.canUseTool("Bash", { command: "ls" }, { requestId: "req-1", toolUseID: "tool-1", signal: new AbortController().signal });
  assert.equal(requests.length, 1);
  assert.equal(adapter.settlePermission("req-1", { behavior: "allow", updatedInput: { command: "ls" } }), true);
  assert.deepEqual(await first, await second);
  assert.equal((await first).behavior, "allow");
});

test("an aborted permission request is denied", async () => {
  const received = {};
  const adapter = createAgentSdkAdapter({
    cwd: ".",
    claudeExecutable: "claude",
    permissionMode: "safe",
    queryImpl: fakeQuery(received),
  });
  await adapter.start();
  const controller = new AbortController();
  const pending = received.options.canUseTool("Read", { file_path: "x" }, {
    requestId: "req-2",
    toolUseID: "tool-2",
    signal: controller.signal,
  });
  controller.abort();
  const result = await pending;
  assert.equal(result.behavior, "deny");
});

test("queue-full is returned and close is idempotent", async () => {
  const received = {};
  const adapter = createAgentSdkAdapter({
    cwd: ".",
    claudeExecutable: "claude",
    permissionMode: "safe",
    queryImpl: fakeQuery(received),
    queueCapacity: 1,
  });
  await adapter.start();
  assert.deepEqual(adapter.send({ id: "1", text: "a" }), { accepted: true });
  assert.deepEqual(adapter.send({ id: "2", text: "b" }), { accepted: false, reason: "full" });
  adapter.close();
  adapter.close();
  assert.equal(received.closed, 1);
  assert.deepEqual(adapter.send({ id: "3", text: "c" }), { accepted: false, reason: "closed" });
});

test("capability gate recognizes the minimum Claude version", () => {
  assert.equal(claudeSupportsDeskRuntime(parseClaudeVersion("2.1.219")), true);
  assert.equal(claudeSupportsDeskRuntime(parseClaudeVersion("2.1.215 (Claude Code)")), false);
  assert.equal(claudeSupportsDeskRuntime(null), false);
});
