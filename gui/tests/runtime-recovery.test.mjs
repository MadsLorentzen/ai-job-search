import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRuntimeFailure,
  interruptWithFallback,
  shouldResumeRuntime,
} from "../runtime-recovery.mjs";

test("classifyRuntimeFailure distinguishes stop, stale session, recoverable, and fatal", () => {
  assert.equal(classifyRuntimeFailure(new Error("stopped"), { stopRequested: true }), "requested-stop");
  assert.equal(classifyRuntimeFailure(new Error("No conversation found with session ID"), {}), "stale-session");
  assert.equal(classifyRuntimeFailure(new Error("EPIPE"), { exitCode: 1 }), "recoverable");
  assert.equal(classifyRuntimeFailure(new Error("authentication_failed"), {}), "fatal");
});

test("shouldResumeRuntime allows exactly one recoverable resume", () => {
  const base = { classification: "recoverable", sessionId: "s1", recoveryAttempts: 0, controller: "chat" };
  assert.equal(shouldResumeRuntime(base), true);
  assert.equal(shouldResumeRuntime({ ...base, recoveryAttempts: 1 }), false);
  assert.equal(shouldResumeRuntime({ ...base, classification: "requested-stop" }), false);
  assert.equal(shouldResumeRuntime({ ...base, classification: "fatal" }), false);
  assert.equal(shouldResumeRuntime({ ...base, sessionId: null }), false);
});

test("interruptWithFallback closes after the grace timeout", async () => {
  const calls = [];
  let resolveInterrupt;
  const session = {
    interrupt: () => {
      calls.push("interrupt");
      return new Promise((resolve) => {
        resolveInterrupt = resolve;
      });
    },
    close: () => {
      calls.push("close");
    },
  };
  const waits = [];
  const result = await interruptWithFallback({
    session,
    graceMs: 3000,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    onFallback: () => calls.push("fallback"),
  });
  assert.equal(result.outcome, "force-closed");
  assert.deepEqual(waits, [3000]);
  assert.deepEqual(calls, ["interrupt", "fallback", "close"]);
  resolveInterrupt?.();
});

test("interruptWithFallback returns interrupted when interrupt resolves in time", async () => {
  const session = {
    interrupt: async () => ({ type: "interrupt" }),
    close: () => {
      throw new Error("should not close");
    },
  };
  const result = await interruptWithFallback({
    session,
    graceMs: 3000,
    sleep: () => new Promise(() => {}),
  });
  assert.equal(result.outcome, "interrupted");
  assert.deepEqual(result.receipt, { type: "interrupt" });
});
