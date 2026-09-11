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

const credentialStore = new CredentialStore();
const eventStore = new ChromeEventStore();
const serverClient = new ServerClient(() => credentialStore.get());
const eventQueue = new DurableEventQueue(eventStore, (event) => serverClient.sendEvent(event));

let router: MessageRouter | null = null;

async function getManualTestValue<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? null;
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

  router = new MessageRouter(eventQueue, handoffSessionId);

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
});

chrome.runtime.onMessage.addListener((message: ContentScriptMessage) => {
  if (!router) return;
  // Fire-and-forget: chrome.runtime.onMessage listeners that return
  // synchronously (no sendResponse used) don't block the content script's
  // sendMessage call on this promise. Enqueue-then-flush ordering is
  // handled inside DurableEventQueue/the router; a failed flush leaves the
  // event durably queued for the next flush trigger, per event-queue.ts's
  // existing retry contract.
  void router.route(message).then(() => eventQueue.flush());
});
