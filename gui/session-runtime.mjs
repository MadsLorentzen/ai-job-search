import { randomUUID } from "node:crypto";
import { createAgentSdkAdapter } from "./agent-sdk-adapter.mjs";
import { createAutofillBridge } from "./autofill-bridge.mjs";
import { normalizeSdkMessage } from "./event-protocol.mjs";
import { createInteractionBroker } from "./interaction-broker.mjs";
import { normalizeDeskPermissionMode } from "./permission-policy.mjs";
import { classifyRuntimeFailure, interruptWithFallback, shouldResumeRuntime } from "./runtime-recovery.mjs";

function commandResult(ok, extra = {}) {
  return ok ? { ok: true, ...extra } : { ok: false, ...extra };
}

export function createSessionRuntime({
  workspace,
  conversationId,
  store,
  adapterFactory = createAgentSdkAdapter,
  normalize = normalizeSdkMessage,
  recoveryPolicy = { classify: classifyRuntimeFailure, shouldResume: shouldResumeRuntime, interrupt: interruptWithFallback },
  brokerFactory = createInteractionBroker,
  permissionPolicy = null,
  artifactService = null,
  autofillBridge = createAutofillBridge(),
  maxQueuedMessages = 8,
  interruptGraceMs = 3000,
  interactionTimeoutMs = 5 * 60 * 1000,
  handoffTimeoutMs = 0,
} = {}) {
  const subscribers = new Set();
  const broker = brokerFactory({
    timeoutMs: interactionTimeoutMs,
    getControllerGeneration: () => conversation()?.controllerGeneration ?? 1,
  });
  let adapter = null;
  let epoch = 0;
  let started = false;
  let pumping = null;
  let pendingHandoff = null;
  let stopRequested = false;

  function conversation() {
    return store.get(conversationId);
  }

  function requireGeneration(expected) {
    const current = conversation();
    if (expected != null && expected !== current.controllerGeneration) {
      return commandResult(false, { reason: "stale-controller" });
    }
    if (pendingHandoff) return commandResult(false, { reason: "handoff-in-progress" });
    return null;
  }

  function currentPermissionMode() {
    return permissionPolicy?.get() ?? conversation()?.permissionMode ?? "safe";
  }

  function snapshot() {
    const current = conversation();
    return {
      conversationId,
      workspace,
      sessionId: current?.claudeSessionId ?? null,
      controller: current?.controller ?? "chat",
      controllerGeneration: current?.controllerGeneration ?? 1,
      permissionMode: currentPermissionMode(),
      busy: Boolean(current?.partialTurn),
      pendingHandoff: pendingHandoff ? { handoffId: pendingHandoff.handoffId, target: pendingHandoff.target } : null,
    };
  }

  function eventContext() {
    const current = conversation();
    return {
      conversationId,
      turnId: current?.partialTurn?.id ?? null,
      nextSequence: () => current.nextSequence,
      now: () => new Date().toISOString(),
      createId: () => randomUUID(),
    };
  }

  async function publishSdkMessage(sdkMessage, currentEpoch) {
    if (currentEpoch !== epoch) return;
    const drafts = normalize(sdkMessage, eventContext());
    for (const draft of drafts) {
      if (currentEpoch !== epoch) return;
      const persisted = await store.appendEvent(conversationId, draft);
      if ((persisted.type === "turn.completed" || persisted.type === "turn.failed") && artifactService) {
        const found = await artifactService.settleTurn(persisted.turnId || conversation()?.partialTurn?.id);
        if (found.length) {
          await store.transact(conversationId, (next) => {
            next.artifacts.push(...found.map((item) => ({
              id: item.id,
              turnId: item.turnId,
              relativePath: item.relativePath,
              kind: item.kind,
              mime: item.mime,
              size: item.size,
            })));
          });
          for (const item of found) {
            const artifactEvent = await store.appendEvent(conversationId, {
              type: "artifact.discovered",
              payload: {
                artifactId: item.id,
                entityId: item.id,
                relativePath: item.relativePath,
                kind: item.kind,
                mime: item.mime,
                turnId: item.turnId,
              },
            });
            for (const listener of subscribers) listener(artifactEvent);
          }
        }
      }
      if (persisted.type === "question.requested") {
        broker.beginQuestion?.({
          requestId: persisted.payload.toolUseId,
          questions: persisted.payload.questions ?? [],
        });
      }
      for (const listener of subscribers) listener(persisted);
    }
  }

  async function pump(currentAdapter, currentEpoch) {
    try {
      for await (const sdkMessage of currentAdapter.messages()) {
        await publishSdkMessage(sdkMessage, currentEpoch);
      }
    } catch (error) {
      const current = conversation();
      const classification = recoveryPolicy.classify(error, { stopRequested });
      if (recoveryPolicy.shouldResume({
        classification,
        sessionId: current?.claudeSessionId,
        recoveryAttempts: current?.recoveryAttempts ?? 0,
        controller: current?.controller,
      })) {
        await store.transact(conversationId, (next) => {
          next.recoveryAttempts += 1;
        });
        await startAdapter();
      }
    }
  }

  async function startAdapter() {
    const current = conversation();
    adapter = adapterFactory({
      cwd: workspace,
      sessionId: current?.claudeSessionId,
      permissionMode: permissionPolicy?.get() ?? current?.permissionMode ?? "safe",
      onPermissionRequest: (request) => broker.beginPermission?.(request),
    });
    await adapter.start();
    const currentEpoch = epoch;
    pumping = pump(adapter, currentEpoch);
  }

  function clearHandoffTimer() {
    if (pendingHandoff?.timer) clearTimeout(pendingHandoff.timer);
  }

  async function beginHandoff(target, expectedControllerGeneration, extra = {}) {
    const stale = requireGeneration(expectedControllerGeneration);
    if (stale && stale.reason === "stale-controller") return stale;
    if (pendingHandoff) return commandResult(false, { reason: "handoff-in-progress" });
    const current = conversation();
    const nextGeneration = current.controllerGeneration + 1;
    const timeoutMs = extra.timeoutMs ?? handoffTimeoutMs;
    const { timeoutMs: _ignored, ...rest } = extra;
    pendingHandoff = {
      handoffId: randomUUID(),
      target,
      from: current.controller,
      nextGeneration,
      ...rest,
    };
    if (timeoutMs > 0) {
      const handoffId = pendingHandoff.handoffId;
      pendingHandoff.timer = setTimeout(() => {
        if (pendingHandoff?.handoffId === handoffId) pendingHandoff = null;
      }, timeoutMs);
    }
    return commandResult(true, {
      handoffId: pendingHandoff.handoffId,
      conversationId,
      nextGeneration,
      workspace,
      sessionId: current.claudeSessionId,
      permissionMode: currentPermissionMode(),
    });
  }

  async function commitHandoff(handoffId, controller, extra = {}) {
    if (!pendingHandoff || pendingHandoff.handoffId !== handoffId) {
      return commandResult(false, { reason: "unknown-handoff" });
    }
    const { nextGeneration, target } = pendingHandoff;
    if (controller !== target) return commandResult(false, { reason: "handoff-mismatch" });
    clearHandoffTimer();
    await store.transact(conversationId, (next) => {
      next.controller = controller;
      next.controllerGeneration = nextGeneration;
      Object.assign(next, extra);
    });
    pendingHandoff = null;
    return commandResult(true, snapshot());
  }

  async function publishAutofillEvent(draft) {
    const persisted = await store.appendEvent(conversationId, draft);
    for (const listener of subscribers) listener(persisted);
    return persisted;
  }

  const api = {
    async start() {
      if (started) return snapshot();
      started = true;
      if (!conversation()) await store.load();
      if (!conversation()) throw new Error(`Unknown conversation ${conversationId}`);
      autofillBridge.cancelOrphaned();
      await startAdapter();
      return snapshot();
    },
    snapshot,
    eventsAfter(sequence) {
      return store.eventsAfter(conversationId, sequence);
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    async submitMessage({ messageId, text, expectedControllerGeneration }) {
      const blocked = requireGeneration(expectedControllerGeneration);
      if (blocked) return blocked;
      if (conversation().controller !== "chat") {
        return commandResult(false, { reason: "wrong-controller" });
      }
      const accepted = adapter.send({ id: messageId, text });
      if (!accepted.accepted) return commandResult(false, { reason: accepted.reason });
      if (artifactService) {
        await artifactService.beginTurn(messageId);
        await store.transact(conversationId, (next) => {
          next.partialTurn = { id: messageId, eventId: messageId };
        });
      }
      return commandResult(true, { messageId });
    },
    async resolvePermission({ requestId, decision, update, reason, expectedControllerGeneration } = {}) {
      const blocked = requireGeneration(expectedControllerGeneration);
      if (blocked) return blocked;
      const result = broker.resolvePermission?.({
        requestId,
        decision,
        update,
        reason,
        expectedControllerGeneration,
      }) ?? commandResult(true, { requestId });
      if (!result.ok) return result;
      adapter.settlePermission?.(requestId, result.result ?? { behavior: "deny", message: "Permission denied" });
      return commandResult(true, { requestId });
    },
    async respondToQuestion({ requestId, value, answers, expectedControllerGeneration } = {}) {
      const blocked = requireGeneration(expectedControllerGeneration);
      if (blocked) return blocked;
      const result = broker.respondToQuestion?.({
        requestId,
        answers: answers ?? (value && typeof value === "object" ? value.answers ?? value : value),
        expectedControllerGeneration,
      });
      if (result && !result.ok) return result;
      const payload = result?.answers ?? value ?? answers;
      const accepted = adapter.send({
        id: requestId,
        text: typeof payload === "string" ? payload : JSON.stringify(payload),
      });
      return accepted.accepted ? commandResult(true, { requestId }) : commandResult(false, { reason: accepted.reason });
    },
    async setPermissionMode({ mode, expectedControllerGeneration } = {}) {
      const blocked = requireGeneration(expectedControllerGeneration);
      if (blocked) return blocked;
      const next = normalizeDeskPermissionMode(mode);
      if (permissionPolicy) await permissionPolicy.set(next);
      await store.transact(conversationId, (current) => {
        current.permissionMode = next;
      });
      await adapter.setPermissionMode?.(next);
      return commandResult(true, snapshot());
    },
    async interrupt({ expectedControllerGeneration } = {}) {
      const blocked = requireGeneration(expectedControllerGeneration);
      if (blocked) return blocked;
      stopRequested = true;
      const result = await recoveryPolicy.interrupt({
        session: adapter,
        graceMs: interruptGraceMs,
      });
      return commandResult(true, result);
    },
    beginTerminalHandoff({ expectedControllerGeneration, timeoutMs } = {}) {
      return beginHandoff("terminal", expectedControllerGeneration, { timeoutMs });
    },
    commitTerminalHandoff({ handoffId, terminalId } = {}) {
      return commitHandoff(handoffId, "terminal", { terminalId });
    },
    async rollbackTerminalHandoff({ handoffId } = {}) {
      if (!pendingHandoff || pendingHandoff.handoffId !== handoffId) {
        return commandResult(false, { reason: "unknown-handoff" });
      }
      clearHandoffTimer();
      pendingHandoff = null;
      return commandResult(true, snapshot());
    },
    beginChatHandoff({ expectedControllerGeneration, terminalId, timeoutMs } = {}) {
      return beginHandoff("chat", expectedControllerGeneration, { terminalId, timeoutMs });
    },
    commitChatHandoff({ handoffId } = {}) {
      return commitHandoff(handoffId, "chat");
    },
    submitTerminalInput({ text, expectedControllerGeneration } = {}) {
      const blocked = requireGeneration(expectedControllerGeneration);
      if (blocked) return blocked;
      if (conversation().controller !== "terminal") {
        return commandResult(false, { reason: "wrong-controller" });
      }
      if (typeof text !== "string") return commandResult(false, { reason: "malformed" });
      return commandResult(true, { accepted: true });
    },
    startAutofillReview() {
      return autofillBridge.start();
    },
    async markAutofillReady({ token, url, screenshot } = {}) {
      const ready = autofillBridge.markReady({ token, url, screenshot });
      if (!ready.ok) return ready;
      const persisted = await publishAutofillEvent({
        type: "autofill.review",
        payload: ready.event.payload,
      });
      return commandResult(true, { ...ready, event: persisted });
    },
    async decideAutofill({ reviewId, token, decision, expectedControllerGeneration } = {}) {
      const blocked = requireGeneration(expectedControllerGeneration);
      if (blocked) return blocked;
      const result = autofillBridge.decide({
        reviewId,
        token,
        decision,
        expectedControllerGeneration,
        currentGeneration: conversation()?.controllerGeneration,
      });
      if (!result.ok) return result;
      if (!result.idempotent) {
        await publishAutofillEvent({
          type: "autofill.resolved",
          payload: { reviewId, entityId: reviewId, decision: result.decision },
        });
      }
      return result;
    },
    pollAutofillDecision({ token } = {}) {
      return autofillBridge.pollDecision({ token });
    },
    async reset({ expectedControllerGeneration } = {}) {
      const blocked = requireGeneration(expectedControllerGeneration);
      if (blocked) return blocked;
      epoch += 1;
      await store.transact(conversationId, (next) => {
        next.partialTurn = null;
        next.queue = [];
        next.controllerGeneration += 1;
      });
      return commandResult(true, snapshot());
    },
    disconnectInteractions() {
      return broker.disconnect?.() ?? 0;
    },
    async stop() {
      stopRequested = true;
      epoch += 1;
      broker.abortAll?.("runtime-stopped");
      autofillBridge.cancelOrphaned();
      adapter?.close?.();
      clearHandoffTimer();
      pendingHandoff = null;
      started = false;
      await pumping?.catch(() => {});
    },
  };
  api.controllers = {
    beginTerminalHandoff: (request) => api.beginTerminalHandoff(request),
    commitTerminalHandoff: (request) => api.commitTerminalHandoff(request),
    rollbackTerminalHandoff: (request) => api.rollbackTerminalHandoff(request),
    beginChatHandoff: (request) => api.beginChatHandoff(request),
    commitChatHandoff: (request) => api.commitChatHandoff(request),
  };
  return api;
}
