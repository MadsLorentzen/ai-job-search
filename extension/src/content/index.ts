import { genericAdapter, greenhouseAdapter, leverAdapter } from "../adapters";
import { runContentScript } from "./content-script";
import { readInjectedSnapshot } from "./snapshot-source";
import type { ContentScriptMessage } from "./messages";

// Greenhouse/Lever tried first (each has a specific, narrow detect()),
// generic last as the catch-all fallback — content-script.test.ts only
// ever exercises a single adapter at a time, so there is no existing
// multi-adapter ordering precedent to match; this ordering is chosen here
// because runContentScript takes the first adapter whose detect() returns
// true (content-script.ts:102), so the most specific match must precede
// the always-true generic fallback.
const adapters = [greenhouseAdapter, leverAdapter, genericAdapter];

const snapshot = readInjectedSnapshot(globalThis as unknown as Record<string, unknown>);

if (snapshot) {
  runContentScript(
    document,
    snapshot,
    adapters,
    (message: ContentScriptMessage) => {
      chrome.runtime.sendMessage(message);
    },
  );
} else {
  // No snapshot was injected — background worker failed to attach one
  // before injecting this script. Nothing to scan against; fail silently
  // rather than throw into the page's own console. Session-start UI
  // (a separate ticket) is responsible for ensuring a snapshot always
  // exists before this script is ever injected.
  console.warn("[JobSearch Handoff] no candidate snapshot available; skipping scan");
}
