import type { Adapter, CandidateSnapshot, DetectedField, FieldDecision } from "../adapters/types";
import type { ContentScriptMessage } from "./messages";

export type SendMessage = (message: ContentScriptMessage) => void;

interface TrackedFieldState {
  pageFieldKey: string;
  domRef: unknown;
  decision: FieldDecision;
  field: DetectedField;
}

export interface PendingSuggestion {
  pageFieldKey: string;
  value: string;
  field: DetectedField;
}

export interface ContentScriptResult {
  suggestions: PendingSuggestion[];
  trackedState: Map<string, TrackedFieldState>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function decisionSummary(decision: FieldDecision) {
  return {
    behavior: decision.behavior,
    mappingReason: decision.mappingReason,
    sourceKind: decision.sourceKind,
    requiresUserApproval: decision.requiresUserApproval,
    adapterId: decision.adapterId,
    adapterVersion: decision.adapterVersion,
  };
}

// Structural checks only — deliberately NOT `instanceof Element` /
// `instanceof HTMLInputElement`. This module has no control over which
// global DOM realm it runs in: in production it runs in the page's own
// window, but under this project's unit tests (vitest's default "node"
// environment, no jsdom environment configured) there is no ambient
// global `Element`/`HTMLInputElement` constructor at all, and each test's
// `new JSDOM(...)` call creates its OWN realm with its OWN constructors.
// An `instanceof` check against the wrong realm's constructor (or against
// an undefined global) would silently fail for every node, which would
// make every "attached" field look "unresolved" and make
// approveSuggestion() a silent no-op on every call. Checking `nodeType`
// and using `Document.contains()` works correctly regardless of which
// realm produced the node.
function isElementNode(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { nodeType?: unknown }).nodeType === 1
  );
}

function isAttached(domRef: unknown, document: Document): domRef is Element {
  return isElementNode(domRef) && document.contains(domRef);
}

function isWritableFormField(
  domRef: unknown,
): domRef is HTMLInputElement {
  return (
    isElementNode(domRef) &&
    "value" in domRef &&
    typeof (domRef as { type?: unknown }).type === "string"
  );
}

function writeValue(input: HTMLInputElement, value: string): void {
  if (input.type === "checkbox") {
    // This module never autofills a checkbox today: none of the current
    // adapters ever return behavior="autofill" for a field whose underlying
    // DOM element is a checkbox (verified against every adapter in the
    // current set). Guarded defensively anyway: writing `.value` to a
    // checkbox does not check/uncheck it, so a value-string write would
    // silently do nothing useful, and the conservative behavior is to
    // no-op rather than to guess whether the caller meant `.checked`.
    return;
  }
  input.value = value;
}

export function runContentScript(
  document: Document,
  snapshot: CandidateSnapshot,
  adapters: Adapter[],
  sendMessage: SendMessage,
  previousState?: Map<string, TrackedFieldState>,
): ContentScriptResult {
  const adapter = adapters.find((a) => a.detect(document));
  const trackedState = new Map<string, TrackedFieldState>(previousState ?? []);
  const suggestions: PendingSuggestion[] = [];

  if (!adapter) {
    return { suggestions, trackedState };
  }

  const seenKeys = new Set<string>();
  const fields = adapter.scan(document);

  for (const field of fields) {
    seenKeys.add(field.pageFieldKey);
    const already = trackedState.get(field.pageFieldKey);

    // Adapter is the ONLY source of classification. This module never
    // recomputes, overrides, or second-guesses a FieldDecision.
    const decision = adapter.classify(field);

    if (!already) {
      sendMessage({
        type: "field_detected",
        pageFieldKey: field.pageFieldKey,
        normalizedFieldType: decision.normalizedFieldType,
        observedAt: nowIso(),
        decision: decisionSummary(decision),
      });
      trackedState.set(field.pageFieldKey, { pageFieldKey: field.pageFieldKey, domRef: field.domRef, decision, field });
    }

    if (decision.behavior === "ask" || decision.behavior === "never") {
      // No DOM write, no further event beyond field_detected. If this is
      // an ask/never field the user might independently fill in, presence
      // detection is a future concern for the not-yet-built DOM-observer
      // wiring, not this scan pass.
      continue;
    }

    if (decision.behavior === "suggest") {
      const value = adapter.map(field, snapshot);
      if (value === null) {
        continue;
      }
      if (!already) {
        sendMessage({
          type: "suggestion_presented",
          pageFieldKey: field.pageFieldKey,
          normalizedFieldType: decision.normalizedFieldType,
          observedAt: nowIso(),
        });
      }
      // Re-surfaced on every scan (event only emitted once, above) so the
      // caller's current-call result always reflects live pending
      // suggestions it can act on, even across repeated scans.
      suggestions.push({ pageFieldKey: field.pageFieldKey, value, field });
      continue;
    }

    if (decision.behavior === "autofill") {
      const value = adapter.map(field, snapshot);
      if (value === null) {
        // Design spec Section 8.3: a value that doesn't actually exist
        // for this candidate degrades to doing nothing — never a blank
        // silent write, never a fallback to some other behavior here
        // (the adapter already decided autofill; a null map() result
        // means there's simply nothing to write).
        continue;
      }
      if (!isAttached(field.domRef, document) || !isWritableFormField(field.domRef)) {
        sendMessage({
          type: "target_unresolved",
          pageFieldKey: field.pageFieldKey,
          normalizedFieldType: decision.normalizedFieldType,
          observedAt: nowIso(),
        });
        continue;
      }
      if (!already) {
        writeValue(field.domRef, value);
        sendMessage({
          type: "value_inserted",
          pageFieldKey: field.pageFieldKey,
          normalizedFieldType: decision.normalizedFieldType,
          observedAt: nowIso(),
          value,
          decision: decisionSummary(decision),
        });
      }
    }
  }

  // Stale-target detection: anything tracked from a previous scan but
  // absent from this scan's field list, or whose domRef is no longer
  // attached, fails closed with target_unresolved rather than being
  // silently dropped or written to.
  for (const [pageFieldKey, tracked] of trackedState) {
    if (seenKeys.has(pageFieldKey)) continue;
    if (!isAttached(tracked.domRef, document)) {
      sendMessage({
        type: "target_unresolved",
        pageFieldKey,
        normalizedFieldType: tracked.decision.normalizedFieldType,
        observedAt: nowIso(),
      });
    }
  }

  return { suggestions, trackedState };
}

export function approveSuggestion(
  result: ContentScriptResult,
  pageFieldKey: string,
  sendMessage: SendMessage,
): void {
  const suggestion = result.suggestions.find((s) => s.pageFieldKey === pageFieldKey);
  if (!suggestion) return;
  const domRef = suggestion.field.domRef;
  if (!isWritableFormField(domRef)) return;

  const tracked = result.trackedState.get(pageFieldKey);
  sendMessage({
    type: "user_approved_insert",
    pageFieldKey,
    normalizedFieldType: tracked?.decision.normalizedFieldType,
    observedAt: nowIso(),
  });
  writeValue(domRef, suggestion.value);
  sendMessage({
    type: "value_inserted",
    pageFieldKey,
    normalizedFieldType: tracked?.decision.normalizedFieldType,
    observedAt: nowIso(),
    value: suggestion.value,
    decision: tracked ? decisionSummary(tracked.decision) : undefined,
  });
}
