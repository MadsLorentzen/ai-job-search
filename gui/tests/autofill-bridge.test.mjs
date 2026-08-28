import assert from "node:assert/strict";
import test from "node:test";
import { createAutofillBridge } from "../autofill-bridge.mjs";

function bridge() {
  let n = 0;
  return createAutofillBridge({
    createId: () => `review-${++n}`,
    createToken: () => `token-${n}`,
  });
}

test("authenticated browser-ready becomes one review card payload", () => {
  const api = bridge();
  const started = api.start();
  const ready = api.markReady({
    token: started.token,
    url: "https://jobs.example/1",
    screenshot: "shot.png",
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.state, "waiting-for-user");
  assert.equal(ready.event.type, "autofill.review");
  assert.equal(ready.event.payload.reviewId, started.reviewId);
  assert.equal(ready.event.payload.url, "https://jobs.example/1");
  assert.equal(ready.event.payload.screenshot, "shot.png");
});

test("wrong token is rejected and never becomes a review card", () => {
  const api = bridge();
  api.start();
  const ready = api.markReady({ token: "wrong", url: "https://jobs.example/1" });
  assert.equal(ready.ok, false);
  assert.equal(ready.reason, "unauthorized");
});

test("duplicate decisions are idempotent and stale generations are rejected", () => {
  const api = bridge();
  const started = api.start();
  api.markReady({ token: started.token, url: "https://jobs.example/1" });
  const first = api.decide({
    reviewId: started.reviewId,
    token: started.token,
    decision: "continue",
    expectedControllerGeneration: 2,
    currentGeneration: 2,
  });
  const again = api.decide({
    reviewId: started.reviewId,
    token: started.token,
    decision: "cancel",
    expectedControllerGeneration: 2,
    currentGeneration: 2,
  });
  assert.equal(first.ok, true);
  assert.equal(first.decision, "continue");
  assert.equal(again.ok, true);
  assert.equal(again.idempotent, true);
  assert.equal(again.decision, "continue");
  assert.equal(again.state, "continue-selected");

  const stale = api.decide({
    reviewId: started.reviewId,
    token: started.token,
    decision: "continue",
    expectedControllerGeneration: 1,
    currentGeneration: 2,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "stale-controller");
});

test("starting a new review cancels an orphaned waiting review", () => {
  const api = bridge();
  const first = api.start();
  api.markReady({ token: first.token, url: "https://jobs.example/1" });
  const second = api.start();
  assert.equal(api.get(first.reviewId).decision, "cancel");
  assert.equal(api.get(first.reviewId).state, "cancel-selected");
  assert.equal(api.get(second.reviewId).state, "starting");
  assert.equal(api.pollDecision({ token: first.token }).decision, "cancel");
});

test("bridge has no submit state or endpoint", () => {
  const api = bridge();
  assert.equal(api.states.has("submit"), false);
  assert.equal(typeof api.submit, "undefined");
});
