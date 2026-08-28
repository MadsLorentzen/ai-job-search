import assert from "node:assert/strict";
import test from "node:test";
import { createAsyncMessageQueue } from "../async-message-queue.mjs";

test("rejects when full or closed", () => {
  const queue = createAsyncMessageQueue({ capacity: 2 });
  assert.deepEqual(queue.push({ id: "1" }), { accepted: true });
  assert.deepEqual(queue.push({ id: "2" }), { accepted: true });
  assert.deepEqual(queue.push({ id: "3" }), { accepted: false, reason: "full" });
  queue.close();
  assert.deepEqual(queue.push({ id: "4" }), { accepted: false, reason: "closed" });
});

test("iterates accepted messages in FIFO order", async () => {
  const queue = createAsyncMessageQueue({ capacity: 3 });
  queue.push({ id: "a" });
  queue.push({ id: "b" });
  queue.close();
  const seen = [];
  for await (const message of queue) seen.push(message.id);
  assert.deepEqual(seen, ["a", "b"]);
});

test("a pending iterator is resolved by the next push", async () => {
  const queue = createAsyncMessageQueue({ capacity: 1 });
  const pending = queue[Symbol.asyncIterator]().next();
  queue.push({ id: "late" });
  assert.deepEqual((await pending).value, { id: "late" });
});

test("fail rejects the pending consumer", async () => {
  const queue = createAsyncMessageQueue({ capacity: 1 });
  const pending = queue[Symbol.asyncIterator]().next();
  queue.fail(new Error("broken"));
  await assert.rejects(pending, /broken/);
  assert.deepEqual(queue.push({ id: "x" }), { accepted: false, reason: "closed" });
});
