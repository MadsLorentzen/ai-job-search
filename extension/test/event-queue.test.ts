import { describe, expect, it, vi } from "vitest";
import { DurableEventQueue, type EventStore, type QueuedEvent } from "../src/background/event-queue";

class InMemoryStore implements EventStore {
  private events: QueuedEvent[] = [];
  async getAll() { return [...this.events]; }
  async add(event: QueuedEvent) { this.events.push(event); }
  async remove(eventId: string) {
    this.events = this.events.filter((e) => e.eventId !== eventId);
  }
}

function makeEvent(overrides: Partial<QueuedEvent> = {}): QueuedEvent {
  return {
    eventId: "evt_1", clientSequence: 1, handoffSessionId: "hs_1",
    eventType: "field_detected", eventPayload: {}, observedAt: "2026-08-24T00:00:00Z",
    ...overrides,
  };
}

describe("DurableEventQueue", () => {
  it("removes an event from the store only after the sender acknowledges", async () => {
    const store = new InMemoryStore();
    const sender = vi.fn().mockResolvedValue(true);
    const queue = new DurableEventQueue(store, sender);

    await queue.enqueue(makeEvent());
    expect(await store.getAll()).toHaveLength(1);

    await queue.flush();
    expect(sender).toHaveBeenCalledOnce();
    expect(await store.getAll()).toHaveLength(0);
  });

  it("keeps a failed event queued for retry", async () => {
    const store = new InMemoryStore();
    const sender = vi.fn().mockResolvedValue(false);
    const queue = new DurableEventQueue(store, sender);

    await queue.enqueue(makeEvent());
    await queue.flush();
    expect(await store.getAll()).toHaveLength(1);
  });

  it("retries in clientSequence order after simulated worker restart", async () => {
    const store = new InMemoryStore();
    await store.add(makeEvent({ eventId: "evt_2", clientSequence: 2 }));
    await store.add(makeEvent({ eventId: "evt_1", clientSequence: 1 }));

    const order: string[] = [];
    const sender = vi.fn().mockImplementation(async (event: QueuedEvent) => {
      order.push(event.eventId);
      return true;
    });
    // simulates a fresh queue instance after the service worker restarted,
    // reading whatever was already durably stored
    const queue = new DurableEventQueue(store, sender);
    await queue.flush();

    expect(order).toEqual(["evt_1", "evt_2"]);
  });

  it("never mints a new eventId to resolve a failed delivery", async () => {
    const store = new InMemoryStore();
    let attempts = 0;
    const sender = vi.fn().mockImplementation(async () => {
      attempts += 1;
      return attempts > 1; // fails first attempt, succeeds second
    });
    const queue = new DurableEventQueue(store, sender);
    await queue.enqueue(makeEvent());

    await queue.flush(); // fails
    await queue.flush(); // succeeds

    const sentEventIds = sender.mock.calls.map(([event]) => event.eventId);
    expect(new Set(sentEventIds)).toEqual(new Set(["evt_1"]));
  });
});
