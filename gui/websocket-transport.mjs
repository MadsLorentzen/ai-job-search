import { WebSocketServer } from "ws";
import { DESK_PROTOCOL_VERSION, validateClientMessage } from "./event-protocol.mjs";

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

export function attachWebSocketTransport({
  server,
  runtime,
  hostAllowed,
  originAllowed,
  path = "/ws",
  WebSocketServerImpl = WebSocketServer,
} = {}) {
  const sockets = new Set();
  const wss = new WebSocketServerImpl({ noServer: true });

  function onUpgrade(req, socket, head) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }
    if (!hostAllowed(req.headers.host || "") || !originAllowed(req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  server.on("upgrade", onUpgrade);

  wss.on("connection", (ws) => {
    sockets.add(ws);
    const seenMessageIds = new Set();
    let unsubscribe = null;
    let helloDone = false;

    ws.on("close", () => {
      sockets.delete(ws);
      unsubscribe?.();
    });

    ws.on("message", async (raw) => {
      let value;
      try {
        value = JSON.parse(String(raw));
      } catch {
        send(ws, { type: "protocol.error", error: "malformed JSON" });
        return;
      }

      if (value?.protocolVersion != null && value.protocolVersion !== DESK_PROTOCOL_VERSION) {
        send(ws, { type: "protocol.error", error: "unsupported protocol version" });
        return;
      }

      const checked = validateClientMessage(value);
      if (!checked.ok) {
        send(ws, { type: "protocol.error", error: checked.error });
        return;
      }
      const message = checked.message;

      if (message.type === "hello") {
        const replay = runtime.eventsAfter(message.afterSequence ?? 0);
        const lastReplayed = replay.at(-1)?.sequence ?? message.afterSequence ?? 0;
        unsubscribe = runtime.subscribe((event) => {
          if (event.sequence <= lastReplayed) return;
          send(ws, { type: "event", event });
        });
        send(ws, { type: "snapshot", snapshot: runtime.snapshot() });
        for (const event of replay) send(ws, { type: "event", event });
        send(ws, { type: "replay.complete" });
        helloDone = true;
        return;
      }

      if (!helloDone) {
        send(ws, { type: "protocol.error", error: "hello required" });
        return;
      }

      if (message.messageId) {
        if (seenMessageIds.has(message.messageId)) {
          send(ws, { type: "command.rejected", reason: "duplicate" });
          return;
        }
        seenMessageIds.add(message.messageId);
      }

      let result = { ok: false, reason: "unsupported" };
      if (message.type === "user.message") {
        result = await runtime.submitMessage({
          messageId: message.messageId,
          text: message.text,
          expectedControllerGeneration: message.expectedControllerGeneration,
        });
      } else if (message.type === "event.ack") {
        runtime.acknowledge?.({ sequence: message.sequence });
        result = { ok: true };
      } else if (message.type === "permission.decision") {
        result = await runtime.resolvePermission(message);
      } else if (message.type === "question.response") {
        result = await runtime.respondToQuestion(message);
      } else if (message.type === "turn.interrupt") {
        result = await runtime.interrupt(message);
      } else if (message.type === "conversation.reset") {
        result = await runtime.reset(message);
      }

      send(ws, result.ok
        ? { type: "command.accepted", command: message.type }
        : { type: "command.rejected", reason: result.reason || "rejected" });
    });
  });

  return {
    async close() {
      server.off("upgrade", onUpgrade);
      for (const socket of sockets) socket.close();
      await new Promise((resolve) => wss.close(resolve));
    },
    clientCount() {
      return sockets.size;
    },
  };
}
