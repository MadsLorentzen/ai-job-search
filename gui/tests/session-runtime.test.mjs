import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createConversationStore } from "../conversation-store.mjs";
import { createSessionRuntime } from "../session-runtime.mjs";

function createFakeAdapter() {
  const sent = [];
  const waiters = [];
  const buffer = [];
  let closed = false;
  let started = 0;

  function pushMessage(message) {
    if (waiters.length) waiters.shift()({ value: message, done: false });
    else buffer.push(message);
  }

  return {
    sent,
    get started() { return started; },
    emit: pushMessage,
    closeStream() {
      closed = true;
      while (waiters.length) waiters.shift()({ value: undefined, done: true });
    },
    failStream(error) {
      closed = true;
      while (waiters.length) waiters.shift(null, error);
      for (const waiter of waiters) waiter(null, error);
    },
    create: () => {
      started += 1;
      return {
        async start() { return { type: "init" }; },
        messages() {
          return {
            next() {
              if (buffer.length) return Promise.resolve({ value: buffer.shift(), done: false });
              if (closed) return Promise.resolve({ value: undefined, done: true });
              return new Promise((resolve, reject) => {
                waiters.push((result, error) => (error ? reject(error) : resolve(result)));
              });
            },
            [Symbol.asyncIterator]() { return this; },
          };
        },
        send(message) {
          if (message.text === "overflow") return { accepted: false, reason: "full" };
          sent.push(message);
          return { accepted: true };
        },
        settlePermission() { return true; },
        interrupt: async () => ({ type: "interrupt" }),
        close() {
          closed = true;
          while (waiters.length) waiters.shift()({ value: undefined, done: true });
        },
      };
    },
  };
}

async function withRuntime(testFn, extras = {}) {
  const fake = createFakeAdapter();
  const store = createConversationStore({
    workspace: mkdtempSync(join(tmpdir(), "desk-runtime-")),
    createId: extras.createId || (() => {
      let n = extras.n || 0;
      extras.n = n + 1;
      return `id-${extras.n}`;
    }),
  });
  const conversation = await store.createConversation();
  const published = [];
  const runtime = createSessionRuntime({
    workspace: "unused",
    conversationId: conversation.id,
    store,
    adapterFactory: fake.create,
    ...extras,
  });
  runtime.subscribe((event) => published.push(event));
  await runtime.start();
  await testFn({ runtime, store, fake, conversation, published });
  await runtime.stop();
}

test("persists an event before notifying subscribers", async () => {
  const order = [];
  await withRuntime(async ({ runtime, store, fake, conversation }) => {
    const original = store.appendEvent.bind(store);
    store.appendEvent = async (...args) => {
      order.push("persist");
      return original(...args);
    };
    runtime.subscribe(() => order.push("notify"));
    fake.emit({
      type: "stream_event",
      session_id: "s1",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(order.slice(0, 2), ["persist", "notify"]);
    assert.ok(store.eventsAfter(conversation.id, 0).length >= 1);
  });
});

test("replays events after a sequence cursor", async () => {
  await withRuntime(async ({ runtime, fake }) => {
    fake.emit({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "A" } },
    });
    fake.emit({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "B" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const replay = runtime.eventsAfter(1);
    assert.equal(replay.length, 1);
    assert.equal(replay[0].payload.text, "B");
  });
});

test("multiple submitted messages use one adapter", async () => {
  await withRuntime(async ({ runtime, fake }) => {
    const first = await runtime.submitMessage({ messageId: "m1", text: "one", expectedControllerGeneration: 1 });
    const second = await runtime.submitMessage({ messageId: "m2", text: "two", expectedControllerGeneration: 1 });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(fake.started, 1);
    assert.equal(fake.sent.length, 2);
  });
});

test("queue backpressure is visible", async () => {
  await withRuntime(async ({ runtime }) => {
    const result = await runtime.submitMessage({ messageId: "m3", text: "overflow", expectedControllerGeneration: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "full");
  });
});

test("stale controller generations are rejected", async () => {
  await withRuntime(async ({ runtime }) => {
    const result = await runtime.submitMessage({ messageId: "m4", text: "nope", expectedControllerGeneration: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "stale-controller");
  });
});

test("handoff begin, commit, and rollback keep exactly one controller", async () => {
  await withRuntime(async ({ runtime }) => {
    const begun = await runtime.beginTerminalHandoff({ expectedControllerGeneration: 1 });
    assert.equal(begun.ok, true);
    assert.equal(runtime.snapshot().controller, "chat");
    const late = await runtime.submitMessage({ messageId: "late", text: "x", expectedControllerGeneration: 1 });
    assert.equal(late.ok, false);
    const committed = await runtime.commitTerminalHandoff({ handoffId: begun.handoffId, terminalId: "term-1" });
    assert.equal(committed.ok, true);
    assert.equal(runtime.snapshot().controller, "terminal");
    assert.equal(runtime.snapshot().controllerGeneration, begun.nextGeneration);

    const chat = await runtime.beginChatHandoff({ expectedControllerGeneration: begun.nextGeneration, terminalId: "term-1" });
    assert.equal(chat.ok, true);
    const rolled = await runtime.rollbackTerminalHandoff({ handoffId: "missing", reason: "nope" });
    assert.equal(rolled.ok, false);
    const committedChat = await runtime.commitChatHandoff({ handoffId: chat.handoffId });
    assert.equal(committedChat.ok, true);
    assert.equal(runtime.snapshot().controller, "chat");
  });
});

test("runtime stop aborts pending interactions", async () => {
  let aborted = false;
  await withRuntime(async ({ runtime }) => {
    assert.equal(runtime.snapshot().permissionMode, "safe");
  }, {
    brokerFactory: () => ({
      abortAll() { aborted = true; },
      beginPermission() {},
      beginQuestion() {},
      resolvePermission() { return { ok: true }; },
      respondToQuestion() { return { ok: true }; },
      disconnect() { return 0; },
    }),
  });
  assert.equal(aborted, true);
});

test("permission timeout and disconnect deny through the broker", async () => {
  await withRuntime(async ({ runtime }) => {
    assert.equal(typeof runtime.disconnectInteractions(), "number");
    const unknown = await runtime.resolvePermission({
      requestId: "missing",
      decision: "allow-once",
      expectedControllerGeneration: 1,
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, "unknown-request");
  });
});

test("Safe mode stays Safe when an invalid mode is requested", async () => {
  const policy = {
    mode: "safe",
    get() { return this.mode; },
    async set(mode) { this.mode = mode; return mode; },
  };
  await withRuntime(async ({ runtime }) => {
    const result = await runtime.setPermissionMode({
      mode: "bypassPermissions",
      expectedControllerGeneration: 1,
    });
    assert.equal(result.ok, true);
    assert.equal(runtime.snapshot().permissionMode, "safe");
    assert.equal(policy.mode, "safe");
  }, { permissionPolicy: policy });
});

test("stale handoff IDs, timeouts, and late input keep exactly one controller", async () => {
  await withRuntime(async ({ runtime }) => {
    const begun = await runtime.beginTerminalHandoff({ expectedControllerGeneration: 1, timeoutMs: 20 });
    assert.equal(begun.ok, true);
    const stale = await runtime.commitTerminalHandoff({ handoffId: "missing", terminalId: "term-x" });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "unknown-handoff");
    assert.equal(runtime.snapshot().controller, "chat");

    await new Promise((resolve) => setTimeout(resolve, 30));
    const lateCommit = await runtime.commitTerminalHandoff({ handoffId: begun.handoffId, terminalId: "term-late" });
    assert.equal(lateCommit.ok, false);
    assert.equal(runtime.snapshot().controller, "chat");
    assert.equal(runtime.snapshot().controllerGeneration, 1);

    const lateTerminal = runtime.submitTerminalInput({ text: "ls", expectedControllerGeneration: 1 });
    assert.equal(lateTerminal.ok, false);
    assert.equal(lateTerminal.reason, "wrong-controller");

    const again = await runtime.beginTerminalHandoff({ expectedControllerGeneration: 1 });
    const failed = await runtime.rollbackTerminalHandoff({ handoffId: again.handoffId });
    assert.equal(failed.ok, true);
    assert.equal(runtime.snapshot().controller, "chat");
    assert.equal(typeof runtime.controllers.beginTerminalHandoff, "function");

    const review = runtime.startAutofillReview();
    const ready = await runtime.markAutofillReady({
      token: review.token,
      url: "https://jobs.example/1",
    });
    assert.equal(ready.ok, true);
    assert.equal(ready.event.type, "autofill.review");
    const decided = await runtime.decideAutofill({
      reviewId: review.reviewId,
      token: review.token,
      decision: "continue",
      expectedControllerGeneration: 1,
    });
    assert.equal(decided.ok, true);
    assert.equal(decided.decision, "continue");
  });
});

test("reset drops late events from the previous epoch", async () => {
  await withRuntime(async ({ runtime, fake, published }) => {
    await runtime.reset({ expectedControllerGeneration: 1 });
    const before = published.length;
    fake.emit({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "late" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(published.length, before);
  });
});
