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
  private clientSequence = 0;

  constructor(
    private readonly queue: DurableEventQueue,
    private readonly handoffSessionId: string,
  ) {}

  async route(message: ContentScriptMessage): Promise<void> {
    this.clientSequence += 1;
    const { type, pageFieldKey, normalizedFieldType, observedAt, ...rest } = message;
    const event: QueuedEvent = {
      eventId: nextEventId(),
      clientSequence: this.clientSequence,
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
