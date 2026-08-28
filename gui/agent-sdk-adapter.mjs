import { query as defaultQuery } from "@anthropic-ai/claude-agent-sdk";
import { createAsyncMessageQueue } from "./async-message-queue.mjs";
import { allowDangerouslySkipPermissions, sdkPermissionMode } from "./permission-policy.mjs";

function deny(message) {
  return { behavior: "deny", message };
}

export function createAgentSdkAdapter({
  cwd,
  claudeExecutable,
  sessionId = null,
  permissionMode = "safe",
  onPermissionRequest,
  onStderr,
  queryImpl = defaultQuery,
  queueCapacity = 8,
} = {}) {
  const queue = createAsyncMessageQueue({ capacity: queueCapacity });
  const pendingPermissions = new Map();
  let session = null;
  let closed = false;

  function requestKey(options) {
    return options.requestId || options.toolUseID;
  }

  function settlePermission(requestId, result) {
    const pending = pendingPermissions.get(requestId);
    if (!pending) return false;
    pendingPermissions.delete(requestId);
    pending.resolve(result);
    return true;
  }

  async function canUseTool(toolName, input, options = {}) {
    const requestId = requestKey(options);
    if (pendingPermissions.has(requestId)) {
      return pendingPermissions.get(requestId).promise;
    }

    let resolve;
    const promise = new Promise((next) => {
      resolve = next;
    });
    pendingPermissions.set(requestId, { promise, resolve });

    const abort = () => settlePermission(requestId, deny("Permission request aborted"));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();

    try {
      const notified = onPermissionRequest?.({
        requestId,
        toolUseId: options.toolUseID,
        toolName,
        input,
        suggestions: options.suggestions,
        title: options.title,
        signal: options.signal,
      });
      if (notified && typeof notified.then === "function") {
        notified.then((value) => settlePermission(requestId, value), abort);
      }
    } catch {
      abort();
    }

    return promise;
  }

  return {
    async start() {
      if (session) return session.initializationResult?.() ?? { type: "init" };
      session = queryImpl({
        prompt: queue,
        options: {
          cwd,
          resume: sessionId || undefined,
          pathToClaudeCodeExecutable: claudeExecutable,
          includePartialMessages: true,
          includeHookEvents: true,
          forwardSubagentText: true,
          settingSources: ["user", "project", "local"],
          permissionMode: sdkPermissionMode(permissionMode),
          allowDangerouslySkipPermissions: allowDangerouslySkipPermissions(permissionMode),
          canUseTool,
          stderr: onStderr,
        },
      });
      return session.initializationResult?.() ?? { type: "init" };
    },
    messages() {
      if (!session) throw new Error("Agent session has not started");
      return session;
    },
    send({ id, text, parentToolUseId = null } = {}) {
      return queue.push({
        type: "user",
        uuid: id,
        parent_tool_use_id: parentToolUseId,
        message: { role: "user", content: text },
      });
    },
    interrupt() {
      return session?.interrupt?.() ?? Promise.resolve(undefined);
    },
    reinitialize() {
      return session?.reinitialize?.() ?? Promise.resolve({ type: "init" });
    },
    setPermissionMode(mode) {
      return session?.setPermissionMode?.(sdkPermissionMode(mode)) ?? Promise.resolve();
    },
    settlePermission,
    close() {
      if (closed) return;
      closed = true;
      queue.close();
      session?.close?.();
    },
  };
}
