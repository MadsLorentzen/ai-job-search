import { describe, expect, it, vi } from "vitest";
import { MessageRouter } from "../src/background/message-router";
import { DurableEventQueue, type EventStore, type QueuedEvent } from "../src/background/event-queue";
import type { ContentScriptMessage } from "../src/content/messages";

class InMemoryStore implements EventStore {
  events: QueuedEvent[] = [];
  async getAll() { return [...this.events]; }
  async add(event: QueuedEvent) { this.events.push(event); }
  async remove(eventId: string) {
    this.events = this.events.filter((e) => e.eventId !== eventId);
  }
}

function makeMessage(overrides: Partial<ContentScriptMessage> = {}): ContentScriptMessage {
  return {
    type: "field_detected",
    pageFieldKey: "greenhouse:application:full_name",
    observedAt: "2026-09-11T00:00:00Z",
    ...overrides,
  };
}

describe("MessageRouter", () => {
  it("enqueues a QueuedEvent carrying the fixed handoffSessionId and an incrementing clientSequence", async () => {
    const store = new InMemoryStore();
    const sender = vi.fn().mockResolvedValue(true);
    const queue = new DurableEventQueue(store, sender);
    const router = new MessageRouter(queue, "hs_1");

    await router.route(makeMessage());
    await router.route(makeMessage({ type: "value_inserted", value: "Jane Doe" }));

    const queued = await store.getAll();
    expect(queued).toHaveLength(2);
    expect(queued[0].handoffSessionId).toBe("hs_1");
    expect(queued[0].clientSequence).toBe(1);
    expect(queued[1].clientSequence).toBe(2);
    expect(queued[1].eventType).toBe("value_inserted");
    expect(queued[1].eventPayload).toMatchObject({ value: "Jane Doe" });
  });

  it("carries pageFieldKey and normalizedFieldType onto the QueuedEvent's own fields, not just the payload", async () => {
    const store = new InMemoryStore();
    const queue = new DurableEventQueue(store, vi.fn().mockResolvedValue(true));
    const router = new MessageRouter(queue, "hs_1");

    await router.route(makeMessage({ normalizedFieldType: "full_name" }));

    const [queued] = await store.getAll();
    expect(queued.pageFieldKey).toBe("greenhouse:application:full_name");
    expect(queued.normalizedFieldType).toBe("full_name");
  });

  it("assigns each event a unique eventId", async () => {
    const store = new InMemoryStore();
    const queue = new DurableEventQueue(store, vi.fn().mockResolvedValue(true));
    const router = new MessageRouter(queue, "hs_1");

    await router.route(makeMessage());
    await router.route(makeMessage());

    const queued = await store.getAll();
    expect(queued[0].eventId).not.toBe(queued[1].eventId);
  });
});
