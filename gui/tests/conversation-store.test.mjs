import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { conversationStorePath, createConversationStore } from "../conversation-store.mjs";
import { saveDeskSession } from "../claude.mjs";

function workspace() {
  return mkdtempSync(join(tmpdir(), "desk-store-"));
}

function storeFor(root, overrides = {}) {
  let n = 0;
  return createConversationStore({
    workspace: root,
    now: () => new Date("2026-08-27T00:00:00.000Z"),
    createId: () => `id-${++n}`,
    ...overrides,
  });
}

test("conversationStorePath lives under .claude/desk", () => {
  const root = "C:\\tmp\\jobs";
  assert.equal(conversationStorePath(root), join(root, ".claude", "desk", "conversations.json"));
});

test("createConversation produces the approved state shape", async () => {
  const store = storeFor(workspace());
  const conversation = await store.createConversation();
  assert.equal(conversation.id, "id-1");
  assert.equal(conversation.claudeSessionId, null);
  assert.deepEqual(conversation.events, []);
  assert.equal(conversation.nextSequence, 1);
  assert.equal(conversation.partialTurn, null);
  assert.deepEqual(conversation.queue, []);
  assert.deepEqual(conversation.artifacts, []);
  assert.equal(conversation.permissionMode, "safe");
  assert.equal(conversation.controller, "chat");
  assert.equal(conversation.controllerGeneration, 1);
  assert.equal(conversation.recoveryAttempts, 0);

  const state = await store.load();
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.activeConversationId, "id-1");
  assert.deepEqual(state.conversations["id-1"], conversation);
});

test("appendEvent orders events and eventsAfter replays after a cursor", async () => {
  const store = storeFor(workspace());
  const conversation = await store.createConversation();
  const first = await store.appendEvent(conversation.id, { type: "assistant.delta", payload: { text: "A" } });
  const second = await store.appendEvent(conversation.id, { type: "assistant.delta", payload: { text: "B" } });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  const replay = store.eventsAfter(conversation.id, 1);
  assert.equal(replay.length, 1);
  assert.equal(replay[0].payload.text, "B");
});

test("transact serializes concurrent mutations", async () => {
  const store = storeFor(workspace());
  const conversation = await store.createConversation();
  await Promise.all([
    store.transact(conversation.id, (current) => {
      current.queue.push("one");
    }),
    store.transact(conversation.id, (current) => {
      current.queue.push("two");
    }),
  ]);
  assert.deepEqual(store.get(conversation.id).queue, ["one", "two"]);
});

test("a failed write keeps the previous file", async () => {
  const root = workspace();
  const path = conversationStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  const store = storeFor(root, {
    fs: {
      mkdir: async () => {},
      readFile: async () => readFileSync(path, "utf8"),
      writeFile: async () => {
        throw new Error("disk full");
      },
      rename: async () => {},
      unlink: async () => {},
    },
  });
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    activeConversationId: "kept",
    conversations: {
      kept: {
        id: "kept",
        claudeSessionId: null,
        events: [],
        nextSequence: 1,
        partialTurn: null,
        queue: [],
        artifacts: [],
        permissionMode: "safe",
        controller: "chat",
        controllerGeneration: 1,
        recoveryAttempts: 0,
      },
    },
  }));
  await store.load();
  await assert.rejects(() => store.createConversation());
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.activeConversationId, "kept");
});

test("corrupt and unsupported schema files are quarantined", async () => {
  const root = workspace();
  const path = conversationStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "{not-json");
  const store = storeFor(root);
  const recovered = await store.load();
  assert.equal(recovered.schemaVersion, 1);
  assert.equal(recovered.activeConversationId, null);
  const corrupt = join(dirname(path), "conversations.corrupt-2026-08-27T00-00-00-000Z.json");
  assert.match(readFileSync(corrupt, "utf8"), /not-json/);

  writeFileSync(path, JSON.stringify({ schemaVersion: 99, conversations: {} }));
  const store2 = storeFor(root, { now: () => new Date("2026-08-27T01:00:00.000Z") });
  await store2.load();
  assert.ok(readFileSync(join(dirname(path), "conversations.corrupt-2026-08-27T01-00-00-000Z.json"), "utf8"));
});

test("imports a valid legacy desk-session.json once", async () => {
  const root = workspace();
  saveDeskSession(root, "legacy-session");
  const store = storeFor(root);
  const state = await store.load();
  const conversation = state.conversations[state.activeConversationId];
  assert.equal(conversation.claudeSessionId, "legacy-session");
});
