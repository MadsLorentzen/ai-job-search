import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";
import { attachWebSocketTransport } from "../websocket-transport.mjs";

function fakeRuntime(overrides = {}) {
  const events = overrides.events || [
    { sequence: 1, type: "assistant.delta", payload: { text: "A" } },
    { sequence: 2, type: "assistant.delta", payload: { text: "B" } },
  ];
  const listeners = new Set();
  const calls = [];
  return {
    calls,
    events,
    listeners,
    snapshot() {
      return { conversationId: "c1", controller: "chat", controllerGeneration: 1 };
    },
    eventsAfter(sequence) {
      return events.filter((event) => event.sequence > sequence);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async submitMessage(message) {
      calls.push(["submitMessage", message]);
      if (message.expectedControllerGeneration !== 1) return { ok: false, reason: "stale-controller" };
      if (calls.filter((item) => item[0] === "submitMessage" && item[1].messageId === message.messageId).length > 1) {
        return { ok: false, reason: "duplicate" };
      }
      return { ok: true, messageId: message.messageId };
    },
    async resolvePermission(message) {
      calls.push(["resolvePermission", message]);
      return { ok: true };
    },
    async interrupt(message) {
      calls.push(["interrupt", message]);
      return { ok: true };
    },
    async reset(message) {
      calls.push(["reset", message]);
      return { ok: true };
    },
    async respondToQuestion(message) {
      calls.push(["respondToQuestion", message]);
      return { ok: true };
    },
    emit(event) {
      events.push(event);
      for (const listener of listeners) listener(event);
    },
  };
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function allowed(port) {
  return {
    hostAllowed: (host) => host === `127.0.0.1:${port}`,
    originAllowed: (origin) => !origin || origin === `http://127.0.0.1:${port}`,
  };
}

async function openDesk(runtime) {
  const server = createServer((_req, res) => res.end("ok"));
  const port = await listen(server);
  const transport = attachWebSocketTransport({
    server,
    runtime,
    path: "/ws",
    ...allowed(port),
  });
  return { server, port, transport, runtime };
}

function connect(port, headers = {}) {
  return new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
}

function attachInbox(ws) {
  const incoming = [];
  const waiters = [];
  ws.on("message", (data) => {
    const value = JSON.parse(String(data));
    if (waiters.length) waiters.shift().resolve(value);
    else incoming.push(value);
  });
  return function readJson() {
    if (incoming.length) return Promise.resolve(incoming.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for websocket message")), 2000);
      waiters.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject,
      });
    });
  };
}

async function handshake(port) {
  const ws = connect(port);
  await once(ws, "open");
  const readJson = attachInbox(ws);
  ws.send(JSON.stringify({ type: "hello", conversationId: "c1", afterSequence: 0, protocolVersion: 1 }));
  const messages = [];
  while (true) {
    const message = await readJson();
    messages.push(message);
    if (message.type === "replay.complete") break;
  }
  return { ws, messages, readJson };
}

function upgradeStatus(port, headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/ws",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...headers,
      },
    }, (res) => resolve(res.statusCode));
    req.on("upgrade", () => resolve(101));
    req.on("error", reject);
    req.end();
  });
}

test("rejected Host and Origin upgrades never open a socket", async () => {
  const { server, port, transport } = await openDesk(fakeRuntime());
  try {
    assert.equal(await upgradeStatus(port, { Host: "127.0.0.1.evil.com" }), 403);
    assert.equal(await upgradeStatus(port, { Origin: "https://evil.example" }), 403);
  } finally {
    await transport.close();
    server.close();
  }
});

test("hello replays persisted events then live events in order", async () => {
  const runtime = fakeRuntime();
  const { server, port, transport } = await openDesk(runtime);
  try {
    const { ws, messages, readJson } = await handshake(port);
    assert.equal(messages[0].type, "snapshot");
    assert.equal(messages[1].type, "event");
    assert.equal(messages[1].event.payload.text, "A");
    assert.equal(messages[2].type, "event");
    assert.equal(messages[2].event.payload.text, "B");
    assert.equal(messages.at(-1).type, "replay.complete");

    const live = readJson();
    runtime.emit({ sequence: 3, type: "assistant.delta", payload: { text: "C" } });
    assert.equal((await live).event.payload.text, "C");
    ws.close();
  } finally {
    await transport.close();
    server.close();
  }
});

test("malformed JSON and protocol mismatch are protocol errors", async () => {
  const { server, port, transport } = await openDesk(fakeRuntime());
  try {
    const ws = connect(port);
    await once(ws, "open");
    const readJson = attachInbox(ws);
    ws.send("not-json");
    assert.equal((await readJson()).type, "protocol.error");
    ws.send(JSON.stringify({ type: "hello", conversationId: "c1", protocolVersion: 99 }));
    assert.equal((await readJson()).type, "protocol.error");
    ws.close();
  } finally {
    await transport.close();
    server.close();
  }
});

test("stale generation and duplicate message IDs are rejected", async () => {
  const { server, port, transport, runtime } = await openDesk(fakeRuntime());
  try {
    const { ws, readJson } = await handshake(port);
    ws.send(JSON.stringify({
      type: "user.message",
      text: "hi",
      messageId: "m1",
      expectedControllerGeneration: 0,
    }));
    assert.equal((await readJson()).type, "command.rejected");

    ws.send(JSON.stringify({
      type: "user.message",
      text: "hi",
      messageId: "m2",
      expectedControllerGeneration: 1,
    }));
    assert.equal((await readJson()).type, "command.accepted");
    ws.send(JSON.stringify({
      type: "user.message",
      text: "hi",
      messageId: "m2",
      expectedControllerGeneration: 1,
    }));
    assert.equal((await readJson()).type, "command.rejected");
    assert.equal(runtime.calls.filter((item) => item[0] === "submitMessage").length, 2);
    ws.close();
  } finally {
    await transport.close();
    server.close();
  }
});

test("permission, interrupt, and reconnect during an active turn", async () => {
  const runtime = fakeRuntime({
    events: [{ sequence: 1, type: "assistant.delta", payload: { text: "partial" } }],
  });
  const { server, port, transport } = await openDesk(runtime);
  try {
    const first = await handshake(port);
    first.ws.send(JSON.stringify({ type: "permission.decision", requestId: "r1", decision: "deny" }));
    assert.equal((await first.readJson()).type, "command.accepted");
    first.ws.send(JSON.stringify({ type: "turn.interrupt" }));
    assert.equal((await first.readJson()).type, "command.accepted");
    first.ws.close();
    await once(first.ws, "close");

    const second = await handshake(port);
    assert.equal(second.messages.some((message) => message.event?.payload?.text === "partial"), true);
    second.ws.close();
  } finally {
    await transport.close();
    server.close();
  }
});
