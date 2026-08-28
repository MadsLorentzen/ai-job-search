export function createDeskState(seed = {}) {
  return {
    lastSequence: seed.lastSequence ?? 0,
    cards: new Map(),
    queued: [],
    permissionMode: seed.permissionMode ?? "safe",
    controller: seed.controller ?? "chat",
    controllerGeneration: seed.controllerGeneration ?? 1,
    conversationId: seed.conversationId ?? null,
    busy: Boolean(seed.busy),
    pendingQuestionId: null,
    pendingPermissionId: null,
  };
}

export function cardIdFor(event) {
  const payload = event?.payload ?? {};
  if (payload.entityId) return payload.entityId;
  if (payload.toolUseId) return payload.toolUseId;
  if (payload.requestId) return payload.requestId;
  if (payload.messageId) return payload.messageId;
  if (event?.type === "assistant.delta" || event?.type === "assistant.message") {
    return `assistant:${event.turnId || "current"}`;
  }
  return event?.eventId;
}

function toRenderableCard(event, id) {
  return {
    id,
    type: event.type === "assistant.delta" ? "assistant.message" : event.type,
    payload: { ...event.payload },
    entered: false,
  };
}

function mergeCard(existing, event) {
  const next = { ...existing, payload: { ...existing.payload, ...event.payload } };
  if (event.type === "assistant.delta") {
    next.type = "assistant.message";
    next.payload.text = `${existing.payload.text || ""}${event.payload?.text || ""}`;
  }
  if (event.type === "tool.completed") {
    next.type = "tool.completed";
    next.payload.phase = "completed";
  }
  if (event.type === "permission.resolved" || event.type === "autofill.resolved") {
    next.entered = true;
    next.payload.decision = event.payload?.decision;
  }
  return next;
}

export function reduceDeskEvent(state, event) {
  if (!event || typeof event.sequence !== "number" || event.sequence <= state.lastSequence) {
    return state;
  }
  const next = structuredClone(state);
  next.lastSequence = event.sequence;

  if (event.type === "user.queued") {
    next.queued.push({
      id: event.payload?.messageId || event.eventId,
      text: event.payload?.text || "",
    });
    return next;
  }

  if (typeof event.payload?.permissionMode === "string") {
    next.permissionMode = event.payload.permissionMode;
  }
  if (event.type === "session.status" && event.payload?.controller) {
    next.controller = event.payload.controller;
  }
  if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.interrupted") {
    next.busy = false;
    next.pendingQuestionId = null;
    next.pendingPermissionId = null;
  }
  if (event.type === "user.message" || event.type === "assistant.delta" || event.type === "tool.started") {
    next.busy = true;
    if (event.payload?.messageId) {
      next.queued = next.queued.filter((item) => item.id !== event.payload.messageId);
    }
  }

  const id = cardIdFor(event);
  if (!id) return next;
  const existing = next.cards.get(id);
  const card = existing ? mergeCard(existing, event) : toRenderableCard(event, id);
  if (event.type === "question.requested") {
    card.entered = false;
    next.pendingQuestionId = id;
  }
  if (event.type === "permission.requested") {
    card.entered = false;
    next.pendingPermissionId = id;
  }
  next.cards.set(id, card);
  return next;
}

export function markEntered(state, entityId) {
  if (!state.cards.has(entityId)) return state;
  const next = structuredClone(state);
  const card = next.cards.get(entityId);
  card.entered = true;
  if (next.pendingQuestionId === entityId) next.pendingQuestionId = null;
  if (next.pendingPermissionId === entityId) next.pendingPermissionId = null;
  return next;
}

export function applySnapshot(state, snapshot = {}) {
  const next = structuredClone(state);
  if (snapshot.permissionMode) next.permissionMode = snapshot.permissionMode;
  if (snapshot.controller) next.controller = snapshot.controller;
  if (snapshot.controllerGeneration != null) next.controllerGeneration = snapshot.controllerGeneration;
  if (snapshot.conversationId) next.conversationId = snapshot.conversationId;
  if (snapshot.busy != null) next.busy = Boolean(snapshot.busy);
  return next;
}

export function queueFollowUp(state, { messageId, text }) {
  return reduceDeskEvent(state, {
    eventId: messageId,
    sequence: state.lastSequence + 1,
    type: "user.queued",
    payload: { messageId, text },
  });
}
