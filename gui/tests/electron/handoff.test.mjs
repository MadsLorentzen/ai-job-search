import assert from "node:assert/strict";
import test from "node:test";
import { createConversationStore } from "../../conversation-store.mjs";
import { createSessionRuntime } from "../../session-runtime.mjs";
import { switchToChat, switchToTerminal } from "../../terminal/handoff.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fakeAdapterFactory() {
  return {
    async start() { return {}; },
    messages() {
      return {
        async next() { return { done: true, value: undefined }; },
        [Symbol.asyncIterator]() { return this; },
      };
    },
    send() { return { accepted: true }; },
    close() {},
  };
}

async function withControllers(testFn) {
  const store = createConversationStore({
    workspace: mkdtempSync(join(tmpdir(), "desk-handoff-")),
  });
  const conversation = await store.createConversation({ claudeSessionId: "sess-shared" });
  const runtime = createSessionRuntime({
    workspace: "/ws",
    conversationId: conversation.id,
    store,
    adapterFactory: fakeAdapterFactory,
  });
  await runtime.start();
  try {
    await testFn(runtime);
  } finally {
    await runtime.stop();
  }
}

test("Chat stops before PTY starts and commit happens only after PTY is ready", async () => {
  await withControllers(async (runtime) => {
    const order = [];
    const result = await switchToTerminal({
      controllers: runtime.controllers,
      expectedControllerGeneration: 1,
      startPty: async (begun) => {
        order.push("pty-start");
        assert.equal(runtime.snapshot().controller, "chat");
        assert.equal(begun.sessionId, "sess-shared");
        return { id: "term-1", dispose() { order.push("dispose"); } };
      },
    });
    order.push("committed");
    assert.equal(result.ok, true);
    assert.equal(runtime.snapshot().controller, "terminal");
    assert.deepEqual(order, ["pty-start", "committed"]);
  });
});

test("PTY failure rolls back to Chat and never activates two controllers", async () => {
  await withControllers(async (runtime) => {
    const result = await switchToTerminal({
      controllers: runtime.controllers,
      expectedControllerGeneration: 1,
      startPty: async () => {
        throw new Error("spawn failed");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "process-failure");
    assert.equal(runtime.snapshot().controller, "chat");
    assert.equal(runtime.snapshot().controllerGeneration, 1);
    assert.equal(runtime.snapshot().pendingHandoff, null);
  });
});

test("terminal exit cannot leave both controllers active; reverse handoff keeps the session", async () => {
  await withControllers(async (runtime) => {
    const started = await switchToTerminal({
      controllers: runtime.controllers,
      expectedControllerGeneration: 1,
      startPty: async () => ({ id: "term-1", dispose() {} }),
    });
    assert.equal(started.ok, true);
    const back = await switchToChat({
      controllers: runtime.controllers,
      expectedControllerGeneration: runtime.snapshot().controllerGeneration,
      terminalId: "term-1",
      disposePty: async () => {},
    });
    assert.equal(back.ok, true);
    assert.equal(runtime.snapshot().controller, "chat");
    assert.equal(runtime.snapshot().sessionId, "sess-shared");
  });
});
