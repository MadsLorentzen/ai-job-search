import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createConversationStore } from "../conversation-store.mjs";
import { createSessionRuntime } from "../session-runtime.mjs";
import { startDesk } from "../server.mjs";

function fakeAdapterFactory() {
  return {
    async start() { return {}; },
    messages() {
      return {
        async next() { return { done: true, value: undefined }; },
        [Symbol.asyncIterator]() { return this; },
      };
    },
    send() { return { accepted: true }; },
    close() {},
  };
}

test("autofill HTTP ready, decide, and stale generation stay authenticated", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "desk-autofill-"));
  const store = createConversationStore({ workspace });
  const conversation = await store.createConversation();
  const runtime = createSessionRuntime({
    workspace,
    conversationId: conversation.id,
    store,
    adapterFactory: fakeAdapterFactory,
  });
  await runtime.start();
  process.env.JOB_SEARCH_GUI_NO_BROWSER = "1";
  const desk = await startDesk({
    root: join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."),
    openBrowser: false,
    port: 0,
    runtime,
  });
  const base = desk.href.replace(/\/$/, "");
  try {
    assert.equal(typeof desk.controllers.beginTerminalHandoff, "function");
    const started = await (await fetch(`${base}/autofill/start`, { method: "POST" })).json();
    assert.ok(started.token);
    const forbidden = await fetch(`${base}/autofill/ready`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
      body: JSON.stringify({ url: "https://jobs.example/1" }),
    });
    assert.equal(forbidden.status, 401);

    const ready = await fetch(`${base}/autofill/ready`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${started.token}` },
      body: JSON.stringify({ token: started.token, url: "https://jobs.example/1", screenshot: "s.png" }),
    });
    assert.equal(ready.status, 200);
    const pending = await (await fetch(`${base}/autofill/decision`, {
      headers: { Authorization: `Bearer ${started.token}` },
    })).json();
    assert.equal(pending.pending, true);

    const stale = await fetch(`${base}/autofill/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewId: started.reviewId,
        token: started.token,
        decision: "continue",
        expectedControllerGeneration: 0,
      }),
    });
    assert.equal(stale.status, 409);

    const decided = await fetch(`${base}/autofill/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewId: started.reviewId,
        token: started.token,
        decision: "continue",
        expectedControllerGeneration: 1,
      }),
    });
    assert.equal(decided.status, 200);
    const poll = await (await fetch(`${base}/autofill/decision`, {
      headers: { Authorization: `Bearer ${started.token}` },
    })).json();
    assert.equal(poll.decision, "continue");
  } finally {
    await runtime.stop();
    desk.stop();
  }
});
