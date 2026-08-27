// The ONLY shapes a content script may send toward the background
// worker. A background-worker listener (future task) receives these
// and is responsible for queuing/sending them via DurableEventQueue/
// ServerClient — this file defines the contract, not the receiver.
// Never includes a credential or any server URL; the content script
// has no access to either (design spec Section 4).

export interface FieldEventMessage {
  type:
    | "field_detected"
    | "suggestion_presented"
    | "user_approved_insert"
    | "value_inserted"
    | "value_observed"
    | "user_value_present_observed"
    | "target_unresolved";
  pageFieldKey: string;
  normalizedFieldType?: string;
  observedAt: string;
  // Present only for value_inserted/value_observed (JobSearch-sourced or
  // drift-checked values) — never present for user_value_present_observed
  // (design spec Section 11.3: presence-only, never the value).
  value?: string;
  decision?: {
    behavior: string;
    mappingReason: string;
    sourceKind: string;
    requiresUserApproval: boolean;
    adapterId: string;
    adapterVersion: string;
  };
}

export type ContentScriptMessage = FieldEventMessage;
