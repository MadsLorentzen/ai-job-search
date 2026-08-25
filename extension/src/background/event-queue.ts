export interface QueuedEvent {
  eventId: string;
  clientSequence: number;
  handoffSessionId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  normalizedFieldType?: string;
  pageFieldKey?: string;
  observedAt: string;
}

export interface EventStore {
  getAll(): Promise<QueuedEvent[]>;
  add(event: QueuedEvent): Promise<void>;
  remove(eventId: string): Promise<void>;
}

export class DurableEventQueue {
  constructor(
    private readonly store: EventStore,
    private readonly sender: (event: QueuedEvent) => Promise<boolean>,
  ) {}

  async enqueue(event: QueuedEvent): Promise<void> {
    // Persisted before any network attempt (design spec Section 13) —
    // this is what survives a killed service worker.
    await this.store.add(event);
  }

  async flush(): Promise<void> {
    const pending = await this.store.getAll();
    const inOrder = [...pending].sort((a, b) => a.clientSequence - b.clientSequence);
    for (const event of inOrder) {
      const acknowledged = await this.sender(event);
      if (acknowledged) {
        await this.store.remove(event.eventId);
      }
      // On failure the event simply stays in the store with its original
      // eventId; the caller never mints a new one to "resolve" the retry.
    }
  }
}
