export const DESK_PROTOCOL_VERSION = 1;

const CLIENT_TYPES = new Set([
  "hello",
  "user.message",
  "event.ack",
  "permission.decision",
  "question.response",
  "turn.interrupt",
  "conversation.reset",
]);

const PERMISSION_DECISIONS = new Set(["allow-once", "allow-scoped", "deny"]);

export function event(type, payload, context) {
  return {
    version: DESK_PROTOCOL_VERSION,
    eventId: context.createId(),
    conversationId: context.conversationId,
    turnId: context.turnId ?? null,
    sequence: context.nextSequence(),
    timestamp: context.now(),
    type,
    payload,
  };
}

function sessionIdOf(message) {
  return typeof message?.session_id === "string" ? message.session_id : undefined;
}

function jsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { unserializable: true };
  }
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function toolResultText(block) {
  if (typeof block?.content === "string") return block.content;
  if (Array.isArray(block?.content)) return textFromContent(block.content);
  return "";
}

export function diagnosticEvent(raw, context) {
  return event("diagnostic.unknown_sdk_event", {
    sdkType: raw?.type ?? "unknown",
    sdkSubtype: raw?.subtype,
    sessionId: sessionIdOf(raw),
    raw: jsonSafe(raw),
  }, context);
}

function fromStreamEvent(message, context) {
  const inner = message.event || {};
  const sessionId = sessionIdOf(message);

  if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
    const block = inner.content_block;
    return [event("tool.started", {
      toolUseId: block.id,
      name: block.name || "tool",
      input: block.input ?? {},
      sessionId,
    }, context)];
  }

  if (inner.delta?.type === "text_delta" && typeof inner.delta.text === "string") {
    return [event("assistant.delta", { text: inner.delta.text, sessionId }, context)];
  }

  if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
    return [event("assistant.delta", { text: inner.delta.text ?? "", sessionId }, context)];
  }

  return [diagnosticEvent(message, context)];
}

function fromAssistant(message, context) {
  const sessionId = sessionIdOf(message);
  const content = message.message?.content;
  const events = [];

  if (message.parent_tool_use_id) {
    events.push(event("subagent.activity", {
      parentToolUseId: message.parent_tool_use_id,
      subagentType: message.subagent_type,
      text: textFromContent(content),
      sessionId,
    }, context));
    return events;
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === "tool_use" && block.name === "AskUserQuestion") {
        events.push(event("question.requested", {
          toolUseId: block.id,
          questions: block.input?.questions ?? [],
          sessionId,
        }, context));
        continue;
      }
      if (block?.type === "tool_use") {
        events.push(event("tool.started", {
          toolUseId: block.id,
          name: block.name || "tool",
          input: block.input ?? {},
          sessionId,
        }, context));
        continue;
      }
      if (block?.type === "text" && block.text) {
        events.push(event("assistant.message", { text: block.text, sessionId }, context));
      }
    }
  }

  if (message.error) {
    events.push(event("turn.failed", { text: String(message.error), sessionId }, context));
  }

  return events.length ? events : [diagnosticEvent(message, context)];
}

function fromUser(message, context) {
  const sessionId = sessionIdOf(message);
  const content = message.message?.content;
  const events = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === "tool_result") {
        events.push(event("tool.completed", {
          toolUseId: block.tool_use_id,
          text: toolResultText(block),
          isError: Boolean(block.is_error),
          sessionId,
        }, context));
      }
    }
  }
  return events.length ? events : [];
}

function fromResult(message, context) {
  const sessionId = sessionIdOf(message);
  const failed = message.is_error || message.subtype !== "success";
  const text = failed
    ? (Array.isArray(message.errors) && message.errors.length ? message.errors.join("; ") : message.result || message.subtype || "Claude reported an error.")
    : message.result || "";
  const events = [
    event(failed ? "turn.failed" : "turn.completed", { text, sessionId, subtype: message.subtype }, context),
  ];
  if (!failed) {
    events.push(event("usage", {
      durationMs: message.duration_ms,
      totalCostUsd: message.total_cost_usd,
      usage: message.usage ?? {},
      sessionId,
    }, context));
  }
  return events;
}

function fromSystem(message, context) {
  const sessionId = sessionIdOf(message);
  if (message.subtype === "init") {
    const events = [
      event("session.status", {
        phase: "ready",
        sessionId,
        model: message.model,
        tools: message.tools ?? [],
      }, context),
    ];
    for (const server of message.mcp_servers ?? []) {
      events.push(event("mcp.status", {
        name: server.name,
        status: server.status,
        sessionId,
      }, context));
    }
    return events;
  }

  if (String(message.subtype || "").startsWith("hook_")) {
    return [event("hook.activity", {
      hookId: message.hook_id,
      hookName: message.hook_name,
      hookEvent: message.hook_event,
      phase: message.subtype.replace("hook_", ""),
      sessionId,
    }, context)];
  }

  if (message.subtype === "permission_denied") {
    return [event("permission.resolved", {
      toolUseId: message.tool_use_id,
      name: message.tool_name,
      decision: "deny",
      sessionId,
    }, context)];
  }

  if (message.subtype === "status" || message.subtype === "session_state_changed") {
    return [event("session.status", {
      phase: message.status || message.state,
      sessionId,
    }, context)];
  }

  return [diagnosticEvent(message, context)];
}

export function normalizeSdkMessage(sdkMessage, context) {
  if (!sdkMessage || typeof sdkMessage !== "object") {
    return [diagnosticEvent(sdkMessage, context)];
  }

  switch (sdkMessage.type) {
    case "stream_event":
      return fromStreamEvent(sdkMessage, context);
    case "assistant":
      return fromAssistant(sdkMessage, context);
    case "user":
      return fromUser(sdkMessage, context);
    case "result":
      return fromResult(sdkMessage, context);
    case "system":
      return fromSystem(sdkMessage, context);
    default:
      return [diagnosticEvent(sdkMessage, context)];
  }
}

function reject(error) {
  return { ok: false, error };
}

export function validateClientMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return reject("message must be an object");
  }
  if (!CLIENT_TYPES.has(value.type)) {
    return reject("unknown message type");
  }

  switch (value.type) {
    case "hello":
      if (typeof value.conversationId !== "string" || !value.conversationId) {
        return reject("hello.conversationId is required");
      }
      if (value.afterSequence != null && (!Number.isInteger(value.afterSequence) || value.afterSequence < 0)) {
        return reject("hello.afterSequence must be a non-negative integer");
      }
      break;
    case "user.message":
      if (typeof value.text !== "string" || !value.text.trim()) {
        return reject("user.message.text is required");
      }
      if (value.expectedControllerGeneration != null && !Number.isInteger(value.expectedControllerGeneration)) {
        return reject("expectedControllerGeneration must be an integer");
      }
      break;
    case "event.ack":
      if (!Number.isInteger(value.sequence) || value.sequence < 0) {
        return reject("event.ack.sequence must be a non-negative integer");
      }
      break;
    case "permission.decision":
      if (typeof value.requestId !== "string" || !value.requestId) {
        return reject("permission.decision.requestId is required");
      }
      if (!PERMISSION_DECISIONS.has(value.decision)) {
        return reject("permission.decision.decision is invalid");
      }
      break;
    case "question.response":
      if (typeof value.requestId !== "string" || !value.requestId) {
        return reject("question.response.requestId is required");
      }
      break;
    case "turn.interrupt":
    case "conversation.reset":
      break;
    default:
      return reject("unknown message type");
  }

  return { ok: true, message: value };
}
