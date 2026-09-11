// extension/src/background/index.ts
import { ChromeEventStore } from "./chrome-event-store";
import { CredentialStore } from "./credential-store";
import { ServerClient } from "./server-client";
import { DurableEventQueue } from "./event-queue";
import { MessageRouter } from "./message-router";
import { INJECTED_SNAPSHOT_KEY } from "../content/snapshot-source";
import type { ContentScriptMessage } from "../content/messages";

// Manual-testing-only storage keys. There is no session-start UI yet
// (separate ticket); until it exists, a developer sets these by hand via
// the service worker's DevTools console before clicking the action icon.
// See docs/superpowers/plans/2026-09-11-extension-runtime-message-relay.md
// Task 7 for the exact commands.
const MANUAL_TEST_SNAPSHOT_KEY = "handoff_manual_test_snapshot";
const MANUAL_TEST_SESSION_ID_KEY = "handoff_manual_test_session_id";
// Stores { sessionId, sequence } together so a stale sequence from a prior
// session can never be mistaken for a valid resume point of a new session —
// see ensureRouter() below.
const MANUAL_TEST_CLIENT_SEQUENCE_KEY = "handoff_manual_test_client_sequence";

interface PersistedClientSequence {
  sessionId: string;
  sequence: number;
}

const credentialStore = new CredentialStore();
const eventStore = new ChromeEventStore();
const serverClient = new ServerClient(() => credentialStore.get());
const eventQueue = new DurableEventQueue(eventStore, (event) => serverClient.sendEvent(event));

let router: MessageRouter | null = null;

async function getManualTestValue<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? null;
}

// Lazily (re)constructs the module-level `router` so a service-worker
// restart (MV3 workers are killed after ~30s idle) never leaves `router`
// null while the content script is still emitting messages — that would
// silently drop events instead of queuing them. Resumes clientSequence
// numbering from chrome.storage.local when the restart is mid-session, and
// starts fresh at 0 when the session id has actually changed, so a stale
// sequence from a prior session is never reused (see event-queue.ts:32's
// sort-by-clientSequence ordering, which a duplicate/rollback would
// corrupt).
async function ensureRouter(): Promise<MessageRouter | null> {
  const handoffSessionId = await getManualTestValue<string>(MANUAL_TEST_SESSION_ID_KEY);
  if (!handoffSessionId) return null;

  if (router && router.handoffSessionId === handoffSessionId) {
    return router;
  }

  const persisted = await getManualTestValue<PersistedClientSequence>(
    MANUAL_TEST_CLIENT_SEQUENCE_KEY,
  );
  const startingClientSequence =
    persisted && persisted.sessionId === handoffSessionId ? persisted.sequence : 0;

  router = new MessageRouter(eventQueue, handoffSessionId, startingClientSequence);
  return router;
}

async function persistClientSequence(current: MessageRouter): Promise<void> {
  const value: PersistedClientSequence = {
    sessionId: current.handoffSessionId,
    sequence: current.clientSequence,
  };
  await chrome.storage.local.set({ [MANUAL_TEST_CLIENT_SEQUENCE_KEY]: value });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const snapshot = await getManualTestValue<Record<string, unknown>>(MANUAL_TEST_SNAPSHOT_KEY);
  const handoffSessionId = await getManualTestValue<string>(MANUAL_TEST_SESSION_ID_KEY);

  if (!snapshot || !handoffSessionId) {
    console.warn(
      "[JobSearch Handoff] no manual-test snapshot/session configured; " +
      "set chrome.storage.local keys '" + MANUAL_TEST_SNAPSHOT_KEY + "' and '" +
      MANUAL_TEST_SESSION_ID_KEY + "' before clicking the action (see plan Task 7).",
    );
    return;
  }

  await ensureRouter();

  // Injection legitimately fails on restricted URLs (chrome://, the Web
  // Store, the built-in PDF viewer, etc.) — catch so one failed click
  // doesn't surface as an unhandled promise rejection.
  try {
    // Both calls deliberately omit `world`, which defaults to "ISOLATED" —
    // NOT "MAIN". The content-script bundle calls chrome.runtime.sendMessage
    // (content/index.ts), and chrome.* APIs do not exist in the MAIN world
    // (that's the whole point of the isolated world: page scripts can never
    // reach extension messaging, per spec section 17's "unreachable from
    // page scripts" requirement and this plan's own Global Constraints).
    // Both executeScript calls share the same isolated-world globalThis for
    // this tab, so the snapshot written by the first call is still visible
    // to the second call's injected bundle via INJECTED_SNAPSHOT_KEY.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (key: string, value: unknown) => {
        (globalThis as unknown as Record<string, unknown>)[key] = value;
      },
      args: [INJECTED_SNAPSHOT_KEY, snapshot],
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/index.js"],
    });
  } catch (err) {
    console.warn("[JobSearch Handoff] injection failed", err);
  }
});

// Cheap defensive guard: chrome.runtime.onMessage fires for messages from
// any context in the extension, not just an injected content script. A
// future popup/options page (separate ticket) would otherwise inherit an
// unvalidated path straight through to the server. A legitimate message
// from the injected content script always has sender.tab.id set (it's
// delivered via chrome.scripting.executeScript into a real tab), so this
// never rejects the intended flow.
function isValidContentScriptMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): message is ContentScriptMessage {
  if (!sender.tab?.id) return false;
  if (typeof message !== "object" || message === null) return false;
  return typeof (message as { type?: unknown }).type === "string";
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isValidContentScriptMessage(message, sender)) return;

  // Fire-and-forget: chrome.runtime.onMessage listeners that return
  // synchronously (no sendResponse used) don't block the content script's
  // sendMessage call on this promise. Enqueue-then-flush ordering is
  // handled inside DurableEventQueue/the router; a failed flush leaves the
  // event durably queued for the next flush trigger, per event-queue.ts's
  // existing retry contract.
  void ensureRouter()
    .then((current) => {
      if (!current) return;
      return current.route(message).then(() =>
        Promise.all([eventQueue.flush(), persistClientSequence(current)]),
      );
    })
    .catch((err) => {
      console.warn("[JobSearch Handoff] relay failed", err);
    });
});
