import { randomBytes, randomUUID } from "node:crypto";

const STATES = new Set([
  "starting",
  "browser-ready",
  "waiting-for-user",
  "continue-selected",
  "cancel-selected",
  "closed",
]);

function commandResult(ok, extra = {}) {
  return ok ? { ok: true, ...extra } : { ok: false, ...extra };
}

export function createAutofillBridge({
  createId = () => randomUUID(),
  createToken = () => randomBytes(24).toString("hex"),
} = {}) {
  const reviews = new Map();

  function get(reviewId) {
    return reviews.get(reviewId) || null;
  }

  function findByToken(token) {
    return [...reviews.values()].find((item) => item.token === token) || null;
  }

  function start() {
    cancelOrphaned();
    const review = {
      id: createId(),
      token: createToken(),
      state: "starting",
      url: null,
      screenshot: null,
      decision: null,
    };
    reviews.set(review.id, review);
    return { reviewId: review.id, token: review.token, state: review.state };
  }

  function markReady({ reviewId, token, url, screenshot } = {}) {
    const review = (reviewId && get(reviewId)) || findByToken(token);
    if (!review || review.token !== token) return commandResult(false, { reason: "unauthorized" });
    if (review.state === "closed") return commandResult(false, { reason: "closed" });
    review.url = url ?? review.url;
    review.screenshot = screenshot ?? review.screenshot;
    review.state = "browser-ready";
    review.state = "waiting-for-user";
    return commandResult(true, {
      reviewId: review.id,
      state: review.state,
      event: {
        type: "autofill.review",
        payload: {
          reviewId: review.id,
          entityId: review.id,
          url: review.url,
          screenshot: review.screenshot,
          token: review.token,
        },
      },
    });
  }

  function decide({ reviewId, token, decision, expectedControllerGeneration, currentGeneration } = {}) {
    if (expectedControllerGeneration != null && expectedControllerGeneration !== currentGeneration) {
      return commandResult(false, { reason: "stale-controller" });
    }
    const review = get(reviewId);
    if (!review || review.token !== token) return commandResult(false, { reason: "unauthorized" });
    if (decision !== "continue" && decision !== "cancel") {
      return commandResult(false, { reason: "malformed" });
    }
    if (review.decision) {
      return commandResult(true, { reviewId, decision: review.decision, idempotent: true, state: review.state });
    }
    review.decision = decision;
    review.state = decision === "continue" ? "continue-selected" : "cancel-selected";
    return commandResult(true, { reviewId, decision, state: review.state });
  }

  function pollDecision({ token } = {}) {
    const review = findByToken(token);
    if (!review) return commandResult(false, { reason: "unauthorized" });
    if (!review.decision) return { ok: true, pending: true };
    return { ok: true, pending: false, decision: review.decision };
  }

  function cancelOrphaned() {
    let count = 0;
    for (const review of reviews.values()) {
      if (review.state === "closed" || review.decision) continue;
      review.decision = "cancel";
      review.state = "cancel-selected";
      count += 1;
    }
    return count;
  }

  function close(reviewId) {
    const review = get(reviewId);
    if (!review) return commandResult(false, { reason: "unknown-review" });
    review.state = "closed";
    return commandResult(true, { reviewId, state: "closed" });
  }

  return {
    start,
    markReady,
    decide,
    pollDecision,
    cancelOrphaned,
    close,
    get,
    states: STATES,
  };
}
