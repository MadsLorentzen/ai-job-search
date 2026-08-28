import assert from "node:assert/strict";
import test from "node:test";
import { createInteractionBroker } from "../interaction-broker.mjs";

function createFakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimeout(fn) {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    flush() {
      for (const [id, fn] of [...timers.entries()]) {
        timers.delete(id);
        fn();
      }
    },
  };
}

function broker(extras = {}) {
  const timers = extras.timers || createFakeTimers();
  let generation = extras.generation ?? 1;
  const interactions = createInteractionBroker({
    timeoutMs: extras.timeoutMs ?? 1000,
    timers,
    getControllerGeneration: () => generation,
  });
  return {
    interactions,
    timers,
    setGeneration(value) {
      generation = value;
    },
  };
}

const laneQuestion = {
  question: "Which lane?",
  header: "Lane",
  options: [{ label: "Healthcare" }, { label: "Defense" }],
  multiSelect: false,
};

const multiQuestion = {
  question: "Which boards?",
  header: "Boards",
  options: [{ label: "LinkedIn" }, { label: "Greenhouse" }, { label: "Ashby" }],
  multiSelect: true,
};

const freeTextQuestion = {
  question: "Anything else?",
  header: "Notes",
};

const workspaceSuggestion = {
  type: "addRules",
  rules: [{ toolName: "Read", ruleContent: "cv/**" }],
  behavior: "allow",
  destination: "localSettings",
};

test("single-choice answers preserve the AskUserQuestion structure", async () => {
  const { interactions } = broker();
  const pending = interactions.beginQuestion({
    requestId: "q-1",
    questions: [laneQuestion],
  });
  const result = interactions.respondToQuestion({
    requestId: "q-1",
    answers: { Lane: "Healthcare" },
    expectedControllerGeneration: 1,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.answers, {
    answers: { Lane: "Healthcare" },
  });
  assert.deepEqual(await pending, result.answers);
});

test("multi-select answers preserve selected option labels", async () => {
  const { interactions } = broker();
  const pending = interactions.beginQuestion({
    requestId: "q-2",
    questions: [multiQuestion],
  });
  const result = interactions.respondToQuestion({
    requestId: "q-2",
    answers: { Boards: ["LinkedIn", "Ashby"] },
    expectedControllerGeneration: 1,
  });
  assert.equal(result.ok, true);
  assert.deepEqual((await pending).answers.Boards, ["LinkedIn", "Ashby"]);
});

test("free-text answers are accepted when a question has no options", async () => {
  const { interactions } = broker();
  const pending = interactions.beginQuestion({
    requestId: "q-3",
    questions: [freeTextQuestion],
  });
  const result = interactions.respondToQuestion({
    requestId: "q-3",
    answers: { Notes: "Remote only" },
    expectedControllerGeneration: 1,
  });
  assert.equal(result.ok, true);
  assert.equal((await pending).answers.Notes, "Remote only");
});

test("malformed question responses are rejected and leave the request pending until denial", async () => {
  const { interactions } = broker();
  const pending = interactions.beginQuestion({
    requestId: "q-4",
    questions: [laneQuestion],
  });
  assert.equal(interactions.respondToQuestion({
    requestId: "q-4",
    answers: { Lane: "Finance" },
    expectedControllerGeneration: 1,
  }).reason, "malformed");
  assert.equal(interactions.respondToQuestion({
    requestId: "q-4",
    answers: { Lane: ["Healthcare"] },
    expectedControllerGeneration: 1,
  }).reason, "malformed");
  assert.equal(interactions.respondToQuestion({
    requestId: "q-2",
    answers: { Boards: ["LinkedIn"] },
    expectedControllerGeneration: 1,
  }).reason, "unknown-request");

  const denied = interactions.abortAll("aborted");
  assert.equal(denied, 1);
  assert.deepEqual(await pending, {
    answers: {},
    cancelled: true,
    reason: "aborted",
  });
});

test("allow-once returns an SDK allow result for the original input", async () => {
  const { interactions } = broker();
  const pending = interactions.beginPermission({
    requestId: "p-1",
    toolName: "Read",
    input: { file_path: "cv/main.tex" },
  });
  const result = interactions.resolvePermission({
    requestId: "p-1",
    decision: "allow-once",
    expectedControllerGeneration: 1,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(await pending, {
    behavior: "allow",
    updatedInput: { file_path: "cv/main.tex" },
  });
});

test("allow-scoped is accepted only for a compatible workspace suggestion", async () => {
  const { interactions } = broker();
  const pending = interactions.beginPermission({
    requestId: "p-2",
    toolName: "Read",
    input: { file_path: "cv/main.tex" },
    suggestions: [workspaceSuggestion],
  });
  const result = interactions.resolvePermission({
    requestId: "p-2",
    decision: "allow-scoped",
    expectedControllerGeneration: 1,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(await pending, {
    behavior: "allow",
    updatedInput: { file_path: "cv/main.tex" },
    updatedPermissions: [workspaceSuggestion],
  });
});

test("allow-scoped without a compatible suggestion is denied", async () => {
  const { interactions } = broker();
  const pending = interactions.beginPermission({
    requestId: "p-3",
    toolName: "Bash",
    input: { command: "rm -rf /" },
    suggestions: [{
      type: "addRules",
      rules: [{ toolName: "Bash" }],
      behavior: "allow",
      destination: "userSettings",
    }],
  });
  const result = interactions.resolvePermission({
    requestId: "p-3",
    decision: "allow-scoped",
    expectedControllerGeneration: 1,
  });
  assert.equal(result.ok, true);
  assert.equal((await pending).behavior, "deny");
});

test("explicit denial and malformed permission decisions fail closed", async () => {
  const { interactions } = broker();
  const pending = interactions.beginPermission({
    requestId: "p-4",
    toolName: "Write",
    input: { file_path: "x" },
  });
  assert.equal(interactions.resolvePermission({
    requestId: "p-4",
    decision: "allow-maybe",
    expectedControllerGeneration: 1,
  }).reason, "malformed");
  const denied = interactions.resolvePermission({
    requestId: "p-4",
    decision: "deny",
    reason: "not this file",
    expectedControllerGeneration: 1,
  });
  assert.equal(denied.ok, true);
  assert.deepEqual(await pending, {
    behavior: "deny",
    message: "not this file",
  });
});

test("timeout, disconnect, and abort deny pending interactions", async () => {
  const { interactions, timers } = broker();
  const permission = interactions.beginPermission({
    requestId: "p-5",
    toolName: "Read",
    input: { file_path: "a" },
  });
  const question = interactions.beginQuestion({
    requestId: "q-5",
    questions: [laneQuestion],
  });
  timers.flush();
  assert.equal((await permission).behavior, "deny");
  assert.equal((await question).cancelled, true);

  const later = interactions.beginPermission({
    requestId: "p-6",
    toolName: "Read",
    input: { file_path: "b" },
  });
  interactions.disconnect();
  assert.equal((await later).behavior, "deny");

  const aborted = interactions.beginQuestion({
    requestId: "q-6",
    questions: [freeTextQuestion],
  });
  interactions.abortAll("runtime-stopped");
  assert.equal((await aborted).reason, "runtime-stopped");
});

test("stale controller generations and duplicate decisions are rejected", async () => {
  const { interactions, setGeneration } = broker();
  const pending = interactions.beginPermission({
    requestId: "p-7",
    toolName: "Read",
    input: { file_path: "c" },
    expectedControllerGeneration: 1,
  });
  setGeneration(2);
  assert.equal(interactions.resolvePermission({
    requestId: "p-7",
    decision: "allow-once",
    expectedControllerGeneration: 1,
  }).reason, "stale-controller");
  assert.equal(interactions.respondToQuestion({
    requestId: "q-missing",
    answers: { Notes: "x" },
    expectedControllerGeneration: 2,
  }).reason, "unknown-request");

  setGeneration(2);
  const allowed = interactions.resolvePermission({
    requestId: "p-7",
    decision: "allow-once",
    expectedControllerGeneration: 2,
  });
  assert.equal(allowed.ok, true);
  assert.equal(interactions.resolvePermission({
    requestId: "p-7",
    decision: "deny",
    expectedControllerGeneration: 2,
  }).reason, "duplicate");
  assert.equal((await pending).behavior, "allow");
});

test("duplicate begin calls share one pending decision", async () => {
  const { interactions } = broker();
  const first = interactions.beginPermission({
    requestId: "p-8",
    toolName: "Read",
    input: { file_path: "shared" },
  });
  const second = interactions.beginPermission({
    requestId: "p-8",
    toolName: "Read",
    input: { file_path: "shared" },
  });
  interactions.resolvePermission({
    requestId: "p-8",
    decision: "deny",
    reason: "once",
    expectedControllerGeneration: 1,
  });
  assert.deepEqual(await first, await second);
});

test("an aborted signal denies the pending permission", async () => {
  const { interactions } = broker();
  const controller = new AbortController();
  const pending = interactions.beginPermission({
    requestId: "p-9",
    toolName: "Read",
    input: { file_path: "d" },
    signal: controller.signal,
  });
  controller.abort();
  assert.equal((await pending).behavior, "deny");
});
