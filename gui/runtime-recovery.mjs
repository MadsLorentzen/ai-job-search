export function classifyRuntimeFailure(error, context = {}) {
  if (context.stopRequested) return "requested-stop";
  const text = String(error?.message || error || "");
  if (/session|conversation found|resume/i.test(text) && /not|no |missing|unknown|stale/i.test(text)) {
    return "stale-session";
  }
  if (/authentication|not installed|login|unauthorized/i.test(text)) return "fatal";
  if (/EPIPE|ECONNRESET|crash|socket/i.test(text) || context.exitCode) return "recoverable";
  return "fatal";
}

export function shouldResumeRuntime({ classification, sessionId, recoveryAttempts, controller }) {
  return classification === "recoverable"
    && Boolean(sessionId)
    && recoveryAttempts === 0
    && controller === "chat";
}

export async function interruptWithFallback({
  session,
  graceMs = 3000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onFallback,
} = {}) {
  const interrupted = Promise.resolve(session.interrupt()).then((receipt) => ({
    outcome: "interrupted",
    receipt,
  }));
  const timedOut = sleep(graceMs).then(() => "timeout");
  const winner = await Promise.race([interrupted, timedOut]);
  if (winner === "timeout") {
    onFallback?.();
    session.close();
    return { outcome: "force-closed" };
  }
  return winner;
}
