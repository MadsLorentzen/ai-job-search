import assert from "node:assert/strict";
import test from "node:test";
import {
  applySnapshot,
  cardIdFor,
  createDeskState,
  markEntered,
  queueFollowUp,
  reduceDeskEvent,
} from "../../public/src/event-store.js";

function event(sequence, type, payload = {}, extras = {}) {
  return {
    eventId: extras.eventId || `e${sequence}`,
    sequence,
    turnId: extras.turnId || "turn-1",
    type,
    payload,
  };
}

test("replay is idempotent and rejects non-monotonic sequences", () => {
  let state = createDeskState();
  const first = event(1, "assistant.delta", { text: "Hi" });
  const second = event(2, "assistant.delta", { text: " there" });
  state = reduceDeskEvent(state, first);
  state = reduceDeskEvent(state, second);
  const replayed = reduceDeskEvent(reduceDeskEvent(state, first), second);
  assert.equal(replayed, state);
  assert.equal(state.lastSequence, 2);
  assert.equal(state.cards.get("assistant:turn-1").payload.text, "Hi there");
});

test("tool cards keep a stable ID across start and late completion", () => {
  let state = createDeskState();
  state = reduceDeskEvent(state, event(1, "tool.started", { toolUseId: "tool-1", name: "Read" }));
  state = reduceDeskEvent(state, event(2, "assistant.delta", { text: "working" }));
  state = reduceDeskEvent(state, event(3, "tool.completed", { toolUseId: "tool-1", text: "ok" }));
  assert.equal(state.cards.size, 2);
  assert.equal(cardIdFor(event(3, "tool.completed", { toolUseId: "tool-1" })), "tool-1");
  assert.equal(state.cards.get("tool-1").type, "tool.completed");
  assert.equal(state.cards.get("tool-1").payload.text, "ok");
});

test("question and permission cards start unentered and can be marked entered", () => {
  let state = createDeskState();
  state = reduceDeskEvent(state, event(1, "question.requested", {
    toolUseId: "q-1",
    questions: [{ question: "Lane?", header: "Lane", options: [{ label: "Healthcare" }] }],
  }));
  state = reduceDeskEvent(state, event(2, "permission.requested", {
    requestId: "p-1",
    toolName: "Read",
    suggestions: [{ type: "addRules", destination: "localSettings", behavior: "allow" }],
  }));
  assert.equal(state.cards.get("q-1").entered, false);
  assert.equal(state.cards.get("p-1").entered, false);
  assert.equal(state.pendingQuestionId, "q-1");
  state = markEntered(state, "q-1");
  assert.equal(state.cards.get("q-1").entered, true);
  assert.equal(state.pendingQuestionId, null);
});

test("queued follow-ups are visible and permission mode comes from the snapshot", () => {
  let state = createDeskState();
  state = reduceDeskEvent(state, event(1, "user.message", { messageId: "m1", text: "go" }));
  assert.equal(state.busy, true);
  state = queueFollowUp(state, { messageId: "m2", text: "and then rank" });
  assert.equal(state.queued[0].text, "and then rank");
  state = applySnapshot(state, { permissionMode: "autonomous", controller: "chat", conversationId: "c1" });
  assert.equal(state.permissionMode, "autonomous");
  assert.equal(state.conversationId, "c1");
});
