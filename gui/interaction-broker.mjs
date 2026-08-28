const PERMISSION_DECISIONS = new Set(["allow-once", "allow-scoped", "deny"]);
const WORKSPACE_DESTINATIONS = new Set(["session", "localSettings", "projectSettings"]);

function commandResult(ok, extra = {}) {
  return ok ? { ok: true, ...extra } : { ok: false, ...extra };
}

function denyPermission(message) {
  return { behavior: "deny", message };
}

function cancelledQuestion(reason) {
  return { answers: {}, cancelled: true, reason };
}

function questionKey(question) {
  return question.header || question.question;
}

function optionLabels(question) {
  return new Set((question.options ?? []).map((option) => option.label));
}

function isFreeText(question) {
  return !Array.isArray(question.options) || question.options.length === 0;
}

function compatibleScopedSuggestions(suggestions, requestedUpdate) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  return list.filter((suggestion) => {
    if (!suggestion || typeof suggestion !== "object") return false;
    if (!WORKSPACE_DESTINATIONS.has(suggestion.destination)) return false;
    if (suggestion.type === "addRules" && suggestion.behavior === "allow") {
      return !requestedUpdate || suggestion === requestedUpdate || deepEqual(suggestion, requestedUpdate);
    }
    if (suggestion.type === "addDirectories") {
      return !requestedUpdate || suggestion === requestedUpdate || deepEqual(suggestion, requestedUpdate);
    }
    return false;
  });
}

function deepEqual(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function validateQuestionAnswers(questions, answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return false;
  for (const question of questions) {
    const key = questionKey(question);
    const value = answers[key];
    if (isFreeText(question)) {
      if (typeof value !== "string" || !value.trim()) return false;
      continue;
    }
    const labels = optionLabels(question);
    if (question.multiSelect) {
      if (!Array.isArray(value) || value.length === 0 || value.some((item) => !labels.has(item))) {
        return false;
      }
      continue;
    }
    if (typeof value !== "string" || !labels.has(value)) return false;
  }
  return true;
}

export function createInteractionBroker({
  timeoutMs = 5 * 60 * 1000,
  timers = globalThis,
  getControllerGeneration = () => 1,
} = {}) {
  const pending = new Map();
  const settledIds = new Set();

  function currentGeneration() {
    return getControllerGeneration();
  }

  function generationMismatch(expected) {
    return expected != null && expected !== currentGeneration();
  }

  function settle(requestId, value) {
    const item = pending.get(requestId);
    if (!item || item.settled) return false;
    item.settled = true;
    settledIds.add(requestId);
    if (item.timeoutId != null) timers.clearTimeout(item.timeoutId);
    item.signal?.removeEventListener?.("abort", item.onAbort);
    pending.delete(requestId);
    item.resolve(value);
    return true;
  }

  function register(kind, request) {
    const requestId = request.requestId;
    if (pending.has(requestId)) return pending.get(requestId).promise;

    let resolve;
    const promise = new Promise((next) => {
      resolve = next;
    });
    const item = {
      kind,
      request,
      promise,
      resolve,
      settled: false,
      timeoutId: null,
      signal: request.signal,
      onAbort: () => {
        if (kind === "permission") {
          settle(requestId, denyPermission("Permission request aborted"));
        } else {
          settle(requestId, cancelledQuestion("aborted"));
        }
      },
    };
    item.timeoutId = timers.setTimeout(() => {
      if (kind === "permission") {
        settle(requestId, denyPermission("Permission request timed out"));
      } else {
        settle(requestId, cancelledQuestion("timeout"));
      }
    }, timeoutMs);
    item.signal?.addEventListener?.("abort", item.onAbort, { once: true });
    if (item.signal?.aborted) item.onAbort();
    pending.set(requestId, item);
    return promise;
  }

  function denyAll(reason) {
    const ids = [...pending.keys()];
    for (const requestId of ids) {
      const item = pending.get(requestId);
      if (!item) continue;
      if (item.kind === "permission") {
        settle(requestId, denyPermission(reason));
      } else {
        settle(requestId, cancelledQuestion(reason));
      }
    }
    return ids.length;
  }

  return {
    beginPermission(request) {
      return register("permission", request);
    },
    beginQuestion(request) {
      return register("question", request);
    },
    resolvePermission({ requestId, decision, update, reason, expectedControllerGeneration } = {}) {
      if (generationMismatch(expectedControllerGeneration)) {
        return commandResult(false, { reason: "stale-controller" });
      }
      if (settledIds.has(requestId)) return commandResult(false, { reason: "duplicate" });
      const item = pending.get(requestId);
      if (!item || item.kind !== "permission") return commandResult(false, { reason: "unknown-request" });
      if (!PERMISSION_DECISIONS.has(decision)) return commandResult(false, { reason: "malformed" });

      let result;
      if (decision === "deny") {
        result = denyPermission(reason || "Permission denied");
      } else if (decision === "allow-once") {
        result = { behavior: "allow", updatedInput: item.request.input };
      } else {
        const scoped = compatibleScopedSuggestions(item.request.suggestions, update);
        result = scoped.length
          ? { behavior: "allow", updatedInput: item.request.input, updatedPermissions: scoped }
          : denyPermission("Scoped approval is unavailable for this request");
      }
      settle(requestId, result);
      return commandResult(true, { requestId, result });
    },
    respondToQuestion({ requestId, answers, expectedControllerGeneration } = {}) {
      if (generationMismatch(expectedControllerGeneration)) {
        return commandResult(false, { reason: "stale-controller" });
      }
      if (settledIds.has(requestId)) return commandResult(false, { reason: "duplicate" });
      const item = pending.get(requestId);
      if (!item || item.kind !== "question") {
        return commandResult(false, { reason: "unknown-request" });
      }
      if (!validateQuestionAnswers(item.request.questions ?? [], answers)) {
        return commandResult(false, { reason: "malformed" });
      }
      const structured = { answers };
      settle(requestId, structured);
      return commandResult(true, { requestId, answers: structured });
    },
    abortAll(reason = "aborted") {
      return denyAll(reason);
    },
    disconnect() {
      return denyAll("disconnected");
    },
    pendingCount() {
      return pending.size;
    },
  };
}
