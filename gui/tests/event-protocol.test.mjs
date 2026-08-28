import assert from "node:assert/strict";
import test from "node:test";
import {
  DESK_PROTOCOL_VERSION,
  diagnosticEvent,
  normalizeSdkMessage,
  validateClientMessage,
} from "../event-protocol.mjs";

function context(overrides = {}) {
  let sequence = 0;
  let ids = 0;
  return {
    conversationId: "conversation-1",
    turnId: "turn-1",
    nextSequence: () => ++sequence,
    now: () => "2026-08-27T00:00:00.000Z",
    createId: () => `event-${++ids}`,
    ...overrides,
  };
}

test("text deltas become assistant.delta events", () => {
  const events = normalizeSdkMessage({
    type: "stream_event",
    session_id: "sess-1",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
  }, context());
  assert.equal(events[0].type, "assistant.delta");
  assert.equal(events[0].payload.text, "Hello");
  assert.equal(events[0].payload.sessionId, "sess-1");
});

test("tool starts keep a stable tool-use ID", () => {
  const events = normalizeSdkMessage({
    type: "stream_event",
    session_id: "sess-1",
    event: {
      type: "content_block_start",
      content_block: { type: "tool_use", id: "tool-1", name: "Read" },
    },
  }, context());
  assert.equal(events[0].type, "tool.started");
  assert.equal(events[0].payload.toolUseId, "tool-1");
  assert.equal(events[0].payload.name, "Read");
});

test("unknown SDK events become diagnostics and stay serializable", () => {
  const raw = { type: "future_kind", subtype: "mystery", extra: { ok: true }, session_id: "sess-1" };
  const events = normalizeSdkMessage(raw, context());
  assert.equal(events[0].type, "diagnostic.unknown_sdk_event");
  assert.equal(events[0].payload.sdkType, "future_kind");
  assert.equal(events[0].payload.sdkSubtype, "mystery");
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].payload.raw)), raw);
});

test("sequence numbers increase strictly across one context", () => {
  const ctx = context();
  const first = normalizeSdkMessage({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "A" } },
  }, ctx);
  const second = normalizeSdkMessage({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "B" } },
  }, ctx);
  assert.equal(first[0].sequence, 1);
  assert.equal(second[0].sequence, 2);
  assert.ok(second[0].sequence > first[0].sequence);
});

test("assistant tool_use and user tool_result share the tool-use ID", () => {
  const ctx = context();
  const started = normalizeSdkMessage({
    type: "assistant",
    session_id: "sess-1",
    parent_tool_use_id: null,
    message: {
      content: [{ type: "tool_use", id: "tool-9", name: "Bash", input: { command: "ls" } }],
    },
  }, ctx);
  const completed = normalizeSdkMessage({
    type: "user",
    session_id: "sess-1",
    message: {
      content: [{ type: "tool_result", tool_use_id: "tool-9", content: "ok", is_error: false }],
    },
  }, ctx);
  assert.equal(started[0].type, "tool.started");
  assert.equal(started[0].payload.toolUseId, "tool-9");
  assert.equal(completed[0].type, "tool.completed");
  assert.equal(completed[0].payload.toolUseId, "tool-9");
});

test("AskUserQuestion becomes a question.requested event", () => {
  const events = normalizeSdkMessage({
    type: "assistant",
    session_id: "sess-1",
    message: {
      content: [{
        type: "tool_use",
        id: "tool-q",
        name: "AskUserQuestion",
        input: {
          questions: [{ question: "Which lane?", header: "Lane", options: [{ label: "Healthcare" }], multiSelect: false }],
        },
      }],
    },
  }, context());
  assert.equal(events[0].type, "question.requested");
  assert.equal(events[0].payload.toolUseId, "tool-q");
  assert.equal(events[0].payload.questions[0].question, "Which lane?");
});

test("system init reports session and MCP status", () => {
  const events = normalizeSdkMessage({
    type: "system",
    subtype: "init",
    session_id: "sess-1",
    model: "claude-sonnet",
    mcp_servers: [{ name: "gmail", status: "connected" }],
  }, context());
  assert.equal(events[0].type, "session.status");
  assert.equal(events[0].payload.sessionId, "sess-1");
  assert.equal(events[0].payload.phase, "ready");
  const mcp = events.find((event) => event.type === "mcp.status");
  assert.equal(mcp.payload.name, "gmail");
  assert.equal(mcp.payload.status, "connected");
});

test("hook and subagent messages become typed activity events", () => {
  const hook = normalizeSdkMessage({
    type: "system",
    subtype: "hook_started",
    hook_id: "hook-1",
    hook_name: "PreToolUse",
    hook_event: "PreToolUse",
    session_id: "sess-1",
  }, context())[0];
  assert.equal(hook.type, "hook.activity");
  assert.equal(hook.payload.hookId, "hook-1");

  const subagent = normalizeSdkMessage({
    type: "assistant",
    session_id: "sess-1",
    parent_tool_use_id: "agent-tool-1",
    subagent_type: "Explore",
    message: { content: [{ type: "text", text: "Looking" }] },
  }, context())[0];
  assert.equal(subagent.type, "subagent.activity");
  assert.equal(subagent.payload.parentToolUseId, "agent-tool-1");
});

test("successful and failed results become turn events plus usage", () => {
  const ok = normalizeSdkMessage({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Done",
    session_id: "sess-1",
    duration_ms: 12,
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 4 },
  }, context());
  assert.equal(ok[0].type, "turn.completed");
  assert.equal(ok[1].type, "usage");
  assert.equal(ok[1].payload.totalCostUsd, 0.01);

  const failed = normalizeSdkMessage({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    errors: ["boom"],
    session_id: "sess-1",
  }, context());
  assert.equal(failed[0].type, "turn.failed");
  assert.match(failed[0].payload.text, /boom/);
});

test("envelope fields are versioned and complete", () => {
  const event = normalizeSdkMessage({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
  }, context())[0];
  assert.equal(event.version, DESK_PROTOCOL_VERSION);
  assert.equal(event.eventId, "event-1");
  assert.equal(event.conversationId, "conversation-1");
  assert.equal(event.turnId, "turn-1");
  assert.equal(event.timestamp, "2026-08-27T00:00:00.000Z");
});

test("diagnosticEvent wraps raw payloads without throwing", () => {
  const event = diagnosticEvent({ type: "weird" }, context());
  assert.equal(event.type, "diagnostic.unknown_sdk_event");
  assert.equal(event.payload.sdkType, "weird");
});

test("validateClientMessage accepts known messages and rejects malformed ones", () => {
  assert.equal(validateClientMessage({ type: "user.message", text: "hi", expectedControllerGeneration: 1 }).ok, true);
  assert.equal(validateClientMessage({ type: "event.ack", sequence: 3 }).ok, true);
  assert.equal(validateClientMessage({ type: "permission.decision", requestId: "r1", decision: "deny" }).ok, true);
  assert.equal(validateClientMessage(null).ok, false);
  assert.equal(validateClientMessage({ type: "explode" }).ok, false);
  assert.equal(validateClientMessage({ type: "user.message" }).ok, false);
});
