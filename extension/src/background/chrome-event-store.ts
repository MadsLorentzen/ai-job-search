import type { EventStore, QueuedEvent } from "./event-queue";

const STORAGE_KEY = "handoff_event_queue";

export class ChromeEventStore implements EventStore {
  async getAll(): Promise<QueuedEvent[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as QueuedEvent[] | undefined) ?? [];
  }

  async add(event: QueuedEvent): Promise<void> {
    const all = await this.getAll();
    all.push(event);
    await chrome.storage.local.set({ [STORAGE_KEY]: all });
  }

  async remove(eventId: string): Promise<void> {
    const all = await this.getAll();
    await chrome.storage.local.set({
      [STORAGE_KEY]: all.filter((event) => event.eventId !== eventId),
    });
  }
}
