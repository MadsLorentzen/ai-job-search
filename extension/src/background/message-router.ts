import type { ContentScriptMessage } from "../content/messages";
import type { DurableEventQueue, QueuedEvent } from "./event-queue";

let counter = 0;
function nextEventId(): string {
  counter += 1;
  return `evt_${Date.now()}_${counter}`;
}

// Translates a ContentScriptMessage (the content script's only allowed
// output shape, per messages.ts) into a QueuedEvent for the durable queue.
// This is the "future task" receiver messages.ts refers to — it adds no
// classification or decision logic of its own, it only reshapes and
// forwards what the content script already decided.
export class MessageRouter {
  private _clientSequence: number;

  // Public so the background worker can detect a handoff-session change
  // (e.g. after a service-worker restart) and know it must construct a
  // fresh router rather than reuse a stale one.
  public readonly handoffSessionId: string;

  constructor(
    private readonly queue: DurableEventQueue,
    handoffSessionId: string,
    startingClientSequence = 0,
  ) {
    this.handoffSessionId = handoffSessionId;
    this._clientSequence = startingClientSequence;
  }

  // Public so the background worker can persist the sequence to
  // chrome.storage.local after each route() call and resume from it if the
  // service worker is torn down and respawned mid-session.
  get clientSequence(): number {
    return this._clientSequence;
  }

  async route(message: ContentScriptMessage): Promise<void> {
    this._clientSequence += 1;
    const { type, pageFieldKey, normalizedFieldType, observedAt, ...rest } = message;
    const event: QueuedEvent = {
      eventId: nextEventId(),
      clientSequence: this._clientSequence,
      handoffSessionId: this.handoffSessionId,
      eventType: type,
      eventPayload: rest,
      normalizedFieldType,
      pageFieldKey,
      observedAt,
    };
    await this.queue.enqueue(event);
  }
}
