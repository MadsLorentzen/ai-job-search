# Extension Runtime Message Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-implemented Application Handoff extension components
(content-script scanner, background event queue, server client) into two real
entry points — a background service worker and a content script — so that
clicking the extension's toolbar action on an ATS tab actually runs the
autofill scan and durably relays its events to the local JobSearch server.

**Architecture:** Two new thin entry-point modules
(`background/index.ts`, `content/index.ts`) act purely as **glue**: they
construct the existing classes (`DurableEventQueue`, `ChromeEventStore`,
`CredentialStore`, `ServerClient`, the adapters) and connect them via Chrome's
extension messaging APIs. No new business logic, no new autofill/classification
behavior, no new HTTP endpoints. All `chrome.*` calls are isolated behind
small functions so the relay/ordering logic stays unit-testable exactly like
the rest of this codebase (constructor injection, in-memory fakes, no DOM/
`chrome` globals in the logic itself).

Explicitly OUT of scope for this plan (confirmed with the user — do not
implement): starting a handoff session (`ServerClient.startSession`),
choosing a `workspace_id`/`pack_artifact_id`, the `(workspace_id,
target_domain)` discovery query, and any "Resume session" prompt UI. Those
require a popup/options page that does not exist yet and is a separate,
larger ticket. This plan assumes a session already exists and its
`handoffSessionId` is available (Task 5 stubs this as a fixed placeholder
read from `chrome.storage.local`, written manually for manual testing — see
Task 5's note).

**Tech Stack:** TypeScript (strict, ES2020/ESNext modules, `moduleResolution: bundler`), Vitest 4, esbuild 0.28 for bundling. Chrome Extension Manifest V3 (`chrome.scripting`, `chrome.action`, `chrome.runtime`, `chrome.storage.local`).

**Spec:** `docs/superpowers/specs/2026-08-24-application-handoff-design.md` (sections 4, 5, 13, 17 govern activation model and permission scope). This plan implements only the runtime-wiring gap identified in the 2026-09-11 blocker report (no ticket doc exists for that report; it was delivered inline in conversation).

## Global Constraints

- Never request `<all_urls>` or any broad host permission. Activation is
  `activeTab` + `chrome.scripting.executeScript` triggered by
  `chrome.action.onClicked`, exactly as required by spec section 17 (line
  728-731: "content scripts are injected only into tabs the user has
  explicitly granted access to (`activeTab` / explicit host patterns), never
  a blanket `<all_urls>` permission by default").
- The background worker is the ONLY module permitted to call `ServerClient`
  or read `CredentialStore` — content scripts never get direct access to the
  credential or the server (spec section 4/17). This plan does not change
  that boundary; the content script only ever calls the injected
  `sendMessage` callback.
- `host_permissions` must add exactly `http://127.0.0.1:8420/*` (the fixed
  `BASE_URL` already hardcoded in `extension/src/background/server-client.ts`)
  — nothing broader.
- No change to `runContentScript`, `approveSuggestion`, any adapter, or any
  `webapp/` file. This is wiring only.
- Every new module with `chrome.*` calls must isolate them behind a function
  taking plain arguments, so tests exercise the logic via injected fakes —
  matching the existing pattern in `content-script.ts` (`isElementNode`
  comment) and `event-queue.test.ts` (`InMemoryStore` fake).
- Do not touch any file under `product/`, `webapp/`, `.github/workflows/`, or
  any onboarding/job-understanding file — those belong to Codex's concurrent
  `codex/release-fix-job-understanding-grounding` work.

---

## File Structure

- `extension/src/background/message-router.ts` — **new**. Pure logic:
  given an incoming `ContentScriptMessage` plus a `clientSequence` counter
  and a `handoffSessionId`, builds a `QueuedEvent` and calls
  `DurableEventQueue.enqueue`. No `chrome.*` references.
- `extension/src/background/index.ts` — **new**. The actual service worker
  entry point. Constructs `ChromeEventStore`, `CredentialStore`,
  `ServerClient`, `DurableEventQueue`, the `message-router`. Registers
  `chrome.action.onClicked` (inject content script bundle into the active
  tab via `chrome.scripting.executeScript`) and `chrome.runtime.onMessage`
  (relay into the router, trigger a queue flush). This file is intentionally
  thin — a wiring/registration file, not tested directly (Chrome API
  registration has no meaningful unit-testable behavior of its own); its
  logic is tested via `message-router.ts` and the existing classes' own
  tests.
- `extension/src/content/index.ts` — **new**. The actual content-script
  entry point injected into the page. Calls `runContentScript(document,
  snapshot, adapters, sendMessage)` against the real page `document`,
  wiring `sendMessage` to `chrome.runtime.sendMessage`. Reads the candidate
  snapshot handed to it via the injection payload (see Task 4). Also thin/
  registration-only, same testing rationale as background/index.ts.
- `extension/src/content/snapshot-source.ts` — **new**. Pure function
  `readInjectedSnapshot(globalObj: Record<string, unknown>):
  CandidateSnapshot | null` — reads a snapshot the background worker attaches
  to the injected execution context. Isolated so it's unit-testable without
  a real `chrome.scripting` injection.
- `extension/manifest.json` — **modify**. Add `host_permissions:
  ["http://127.0.0.1:8420/*"]`. `background.service_worker` already points
  at `background/index.js` (matches the bundler output path from Task 6).
- `extension/test/message-router.test.ts` — **new**.
- `extension/test/snapshot-source.test.ts` — **new**.
- `extension/package.json` — **modify**. Add a real `build` script (Task 6;
  this task's bundling need is satisfied by that script, not a separate one).

---

### Task 1: Message router — turn a content-script message into a queued event

**Files:**
- Create: `extension/src/background/message-router.ts`
- Test: `extension/test/message-router.test.ts`

**Interfaces:**
- Consumes: `ContentScriptMessage` from `extension/src/content/messages.ts`
  (existing, unchanged); `QueuedEvent`, `DurableEventQueue` from
  `extension/src/background/event-queue.ts` (existing, unchanged).
- Produces: `class MessageRouter` with constructor
  `(queue: DurableEventQueue, handoffSessionId: string)` and method
  `async route(message: ContentScriptMessage): Promise<void>`. Later tasks
  (background/index.ts) construct this with a real `DurableEventQueue` and
  call `.route()` from the `chrome.runtime.onMessage` listener.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/test/message-router.test.ts
import { describe, expect, it, vi } from "vitest";
import { MessageRouter } from "../src/background/message-router";
import { DurableEventQueue, type EventStore, type QueuedEvent } from "../src/background/event-queue";
import type { ContentScriptMessage } from "../src/content/messages";

class InMemoryStore implements EventStore {
  events: QueuedEvent[] = [];
  async getAll() { return [...this.events]; }
  async add(event: QueuedEvent) { this.events.push(event); }
  async remove(eventId: string) {
    this.events = this.events.filter((e) => e.eventId !== eventId);
  }
}

function makeMessage(overrides: Partial<ContentScriptMessage> = {}): ContentScriptMessage {
  return {
    type: "field_detected",
    pageFieldKey: "greenhouse:application:full_name",
    observedAt: "2026-09-11T00:00:00Z",
    ...overrides,
  };
}

describe("MessageRouter", () => {
  it("enqueues a QueuedEvent carrying the fixed handoffSessionId and an incrementing clientSequence", async () => {
    const store = new InMemoryStore();
    const sender = vi.fn().mockResolvedValue(true);
    const queue = new DurableEventQueue(store, sender);
    const router = new MessageRouter(queue, "hs_1");

    await router.route(makeMessage());
    await router.route(makeMessage({ type: "value_inserted", value: "Jane Doe" }));

    const queued = await store.getAll();
    expect(queued).toHaveLength(2);
    expect(queued[0].handoffSessionId).toBe("hs_1");
    expect(queued[0].clientSequence).toBe(1);
    expect(queued[1].clientSequence).toBe(2);
    expect(queued[1].eventType).toBe("value_inserted");
    expect(queued[1].eventPayload).toMatchObject({ value: "Jane Doe" });
  });

  it("carries pageFieldKey and normalizedFieldType onto the QueuedEvent's own fields, not just the payload", async () => {
    const store = new InMemoryStore();
    const queue = new DurableEventQueue(store, vi.fn().mockResolvedValue(true));
    const router = new MessageRouter(queue, "hs_1");

    await router.route(makeMessage({ normalizedFieldType: "full_name" }));

    const [queued] = await store.getAll();
    expect(queued.pageFieldKey).toBe("greenhouse:application:full_name");
    expect(queued.normalizedFieldType).toBe("full_name");
  });

  it("assigns each event a unique eventId", async () => {
    const store = new InMemoryStore();
    const queue = new DurableEventQueue(store, vi.fn().mockResolvedValue(true));
    const router = new MessageRouter(queue, "hs_1");

    await router.route(makeMessage());
    await router.route(makeMessage());

    const queued = await store.getAll();
    expect(queued[0].eventId).not.toBe(queued[1].eventId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run test/message-router.test.ts`
Expected: FAIL — `Cannot find module '../src/background/message-router'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// extension/src/background/message-router.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run test/message-router.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/background/message-router.ts extension/test/message-router.test.ts
git commit -m "feat(extension): add message router translating content-script events to queued events"
```

---

### Task 2: Snapshot source — read the candidate snapshot handed to the injected content script

**Files:**
- Create: `extension/src/content/snapshot-source.ts`
- Test: `extension/test/snapshot-source.test.ts`

**Interfaces:**
- Consumes: `CandidateSnapshot` type from `extension/src/adapters/types.ts`
  (existing, unchanged).
- Produces: `readInjectedSnapshot(globalObj: Record<string, unknown>):
  CandidateSnapshot | null` and the constant
  `INJECTED_SNAPSHOT_KEY = "__jobsearch_handoff_snapshot__"`. Task 3
  (`content/index.ts`) calls this against `globalThis`. Task 4
  (`background/index.ts`) writes to this same key via
  `chrome.scripting.executeScript`'s `args`/injected function before
  injecting the real content script.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/test/snapshot-source.test.ts
import { describe, expect, it } from "vitest";
import { INJECTED_SNAPSHOT_KEY, readInjectedSnapshot } from "../src/content/snapshot-source";
import type { CandidateSnapshot } from "../src/adapters/types";

function makeSnapshot(): CandidateSnapshot {
  return {
    identity: { name: { value: "Jane Doe", profile_evidence_ids: ["clm_1"] } },
    contact: {},
    employment: [],
  };
}

describe("readInjectedSnapshot", () => {
  it("reads the snapshot from the well-known global key", () => {
    const snapshot = makeSnapshot();
    const fakeGlobal = { [INJECTED_SNAPSHOT_KEY]: snapshot };

    expect(readInjectedSnapshot(fakeGlobal)).toBe(snapshot);
  });

  it("returns null when no snapshot was injected", () => {
    expect(readInjectedSnapshot({})).toBeNull();
  });

  it("returns null rather than throwing when the key holds a non-object value", () => {
    expect(readInjectedSnapshot({ [INJECTED_SNAPSHOT_KEY]: "not-a-snapshot" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run test/snapshot-source.test.ts`
Expected: FAIL — `Cannot find module '../src/content/snapshot-source'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// extension/src/content/snapshot-source.ts
import type { CandidateSnapshot } from "../adapters/types";

// The background worker (background/index.ts) writes the candidate
// snapshot to this key on the page's global object as part of the same
// chrome.scripting.executeScript call that injects the content script
// bundle, immediately before it — the content script (content/index.ts)
// then reads it back here. This avoids a second message round-trip just
// to hand over data the background worker already fetched.
export const INJECTED_SNAPSHOT_KEY = "__jobsearch_handoff_snapshot__";

export function readInjectedSnapshot(
  globalObj: Record<string, unknown>,
): CandidateSnapshot | null {
  const value = globalObj[INJECTED_SNAPSHOT_KEY];
  if (typeof value !== "object" || value === null) return null;
  return value as CandidateSnapshot;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run test/snapshot-source.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/snapshot-source.ts extension/test/snapshot-source.test.ts
git commit -m "feat(extension): add injected candidate-snapshot reader for content script"
```

---

### Task 3: Content script entry point

**Files:**
- Create: `extension/src/content/index.ts`

**Interfaces:**
- Consumes: `runContentScript` from `extension/src/content/content-script.ts`
  (existing, unchanged); `genericAdapter, greenhouseAdapter, leverAdapter`
  from `extension/src/adapters/index.ts` (existing, unchanged);
  `readInjectedSnapshot` from Task 2.
- Produces: a side-effecting module (no exports needed — this is the actual
  file esbuild bundles as the content-script entry point in Task 6). Running
  it calls `runContentScript` once against `document` and wires
  `sendMessage` to `chrome.runtime.sendMessage`.

This task has no unit test of its own: it is 100% `chrome.*`/`document`
glue with no branching logic — the logic it calls (`runContentScript`,
`readInjectedSnapshot`) is already tested in Tasks 1-2 and the pre-existing
`content-script.test.ts`. Manual verification happens in Task 7.

- [ ] **Step 1: Write the entry point**

```typescript
// extension/src/content/index.ts
import { genericAdapter } from "../adapters/generic";
import { greenhouseAdapter } from "../adapters/greenhouse";
import { leverAdapter } from "../adapters/lever";
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
```

- [ ] **Step 2: Type-check**

Run: `cd extension && npx tsc --noEmit`
Expected: no errors. If `chrome` is not a recognized global, proceed to Task
3a below before re-running.

- [ ] **Step 2a: Add Chrome type definitions if the type-check fails on `chrome.*`**

If step 2 errors with `Cannot find name 'chrome'`, install and wire
`@types/chrome`:

```bash
cd extension && npm install --save-dev @types/chrome
```

Add `"types": ["chrome"]` to `extension/tsconfig.json`'s `compilerOptions`.
Re-run `npx tsc --noEmit` — expect no errors.

- [ ] **Step 3: Commit**

```bash
git add extension/src/content/index.ts extension/tsconfig.json extension/package.json extension/package-lock.json
git commit -m "feat(extension): add content-script entry point wiring runContentScript to chrome.runtime"
```

---

### Task 4: Background service worker entry point

**Files:**
- Create: `extension/src/background/index.ts`

**Interfaces:**
- Consumes: `ChromeEventStore` (`extension/src/background/chrome-event-store.ts`),
  `CredentialStore` (`extension/src/background/credential-store.ts`),
  `ServerClient` (`extension/src/background/server-client.ts`),
  `DurableEventQueue` (`extension/src/background/event-queue.ts`) — all
  existing, unchanged; `MessageRouter` from Task 1;
  `INJECTED_SNAPSHOT_KEY` from Task 2.
- Produces: a side-effecting module (bundled as the service worker entry
  point in Task 6). Registers `chrome.action.onClicked` and
  `chrome.runtime.onMessage`.

This task has no unit test of its own for the same reason as Task 3 — it is
Chrome API registration glue. Its only real logic (translating a message
into a queued event) is `MessageRouter`, already tested in Task 1. Manual
verification happens in Task 7.

**Note on the snapshot placeholder:** per this plan's stated out-of-scope
boundary, there is no session-start flow yet to produce a real
`CandidateSnapshot` or `handoffSessionId`. This task reads both from
`chrome.storage.local` under fixed keys (`handoff_manual_test_snapshot`,
`handoff_manual_test_session_id`) that a developer sets manually via the
Chrome DevTools console during manual testing (Task 7 documents the exact
commands). This is explicitly a manual-testing bridge, not a production
session-start substitute — it must not be represented as one.

- [ ] **Step 1: Write the entry point**

```typescript
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
```

- [ ] **Step 2: Type-check**

Run: `cd extension && npx tsc --noEmit`
Expected: no errors (assumes Task 3a's `@types/chrome` install already ran).

- [ ] **Step 3: Commit**

```bash
git add extension/src/background/index.ts
git commit -m "feat(extension): add background service worker entry point wiring action-click injection and message relay"
```

---

### Task 5: Manifest updates

**Files:**
- Modify: `extension/manifest.json`

**Interfaces:**
- Consumes: nothing new — references file paths that Task 6's build
  produces (`background/index.js`, `content/index.js`).
- Produces: a manifest ready for Task 6's build to copy into `dist/`.

- [ ] **Step 1: Add the loopback host permission**

Edit `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "JobSearch Application Handoff",
  "version": "0.1.0",
  "description": "Autofill and document handoff for confirmed JobSearch application packs.",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["http://127.0.0.1:8420/*"],
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "action": {
    "default_title": "JobSearch Handoff"
  },
  "content_scripts": []
}
```

Only the `host_permissions` line changes (`[]` → `["http://127.0.0.1:8420/*"]`).
`content_scripts` stays `[]` — injection is on-demand via
`chrome.scripting.executeScript` (Task 4), not a static manifest match, per
this plan's Global Constraints.

- [ ] **Step 2: Verify it's valid JSON**

Run: `cd extension && node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.json
git commit -m "feat(extension): grant loopback host permission for local server calls"
```

---

### Task 6: Full test suite and type-check pass

**Files:** none new — verification only.

- [ ] **Step 1: Run the full extension test suite**

Run: `cd extension && npx vitest run`
Expected: all tests pass, including the two new files from Tasks 1-2 and
every pre-existing test (`content-script.test.ts`,
`adapters-generic.test.ts`, `adapters-greenhouse.test.ts`,
`adapters-lever.test.ts`, `attachment.test.ts`, `derivations.test.ts`,
`event-queue.test.ts`, `legal-patterns.test.ts`, `safe-catalog.test.ts`) —
zero regressions.

- [ ] **Step 2: Run the full type-check**

Run: `cd extension && npx tsc --noEmit`
Expected: no errors across `src` and `test`.

- [ ] **Step 3: Commit (only if step 1 or 2 required fixes)**

If both passed clean with no changes needed, skip this step — nothing to
commit. Otherwise:

```bash
git add -A extension/
git commit -m "fix(extension): resolve test/type-check issues surfaced by runtime wiring"
```

---

## Self-Review Notes

**Spec coverage:** The 2026-09-11 blocker report's "minimum missing runtime
wiring" (item 4) listed four pieces — action-click injection, message relay,
a queue-flush driver, and a real-document content-script entry point. All
four are covered: injection (Task 4), relay (Tasks 1 + 4), flush driver
(Task 4's `.then(() => eventQueue.flush())` — triggered per-message rather
than on a timer/alarm, which is simpler and sufficient since
`DurableEventQueue.flush()` is idempotent and already handles partial
failure via retry-on-next-call), and content-script entry point (Task 3).

**Deliberately deferred, not silently dropped:** session-start
(`ServerClient.startSession`), the `(workspace_id, target_domain)`
discovery query, and "Resume session" UI are named in the Goal section as
out of scope and bridged with an explicit, clearly-labeled manual-testing
mechanism (Task 4's `chrome.storage.local` keys) rather than being quietly
implemented or quietly ignored.

**Placeholder scan:** no TBD/TODO markers; the one intentionally-manual
piece (snapshot/session-id source) is fully specified with exact storage
keys and exact console commands (Task 7 below), not left vague.

**Type consistency:** `MessageRouter.route(message: ContentScriptMessage)`
signature is identical between Task 1's test and Task 4's usage.
`readInjectedSnapshot(globalObj: Record<string, unknown>)` and
`INJECTED_SNAPSHOT_KEY` are identical between Task 2's test, Task 3's
import, and Task 4's import.

**Post-draft fixes (found during plan review, applied before execution):**
- Task 4's two `chrome.scripting.executeScript` calls originally specified
  `world: "MAIN"`. That would have run the injected content script in the
  page's own JS realm, where `chrome.*` APIs do not exist — Task 3's
  `chrome.runtime.sendMessage` call would have thrown immediately, breaking
  the entire relay, and it directly contradicted this plan's own Global
  Constraints and spec section 17's "unreachable from page scripts"
  requirement. Fixed: both calls now omit `world` (defaults to
  `"ISOLATED"`), which still shares one `globalThis` between the two calls
  for the same tab, so the snapshot-handoff mechanism is unaffected.
- Task 3's adapter-ordering comment claimed to match "existing test
  fixtures' adapter ordering in content-script.test.ts" — false;
  that file only ever tests a single adapter (`[genericAdapter]`) at a
  time, no ordering precedent exists there. Fixed: the comment now states
  the real reason (specific `detect()` must precede the always-true
  generic fallback, per `content-script.ts:102`'s first-match behavior)
  instead of citing a nonexistent precedent.

---

### Task 7: Manual verification instructions (not a coding task — reference for whoever runs Chrome "Load unpacked")

This task has no files and no commit. It documents the exact steps to
manually exercise the wiring built above, once Task 6 of the (separate,
already-scoped) local-build plan produces `extension/dist/`.

1. Load `extension/dist/` unpacked in Chrome (`chrome://extensions` →
   Developer mode → Load unpacked).
2. Open the extension's service worker DevTools console (`chrome://extensions`
   → the extension card → "service worker" link).
3. In that console, set the manual-test snapshot and session id:
   ```js
   chrome.storage.local.set({
     handoff_manual_test_snapshot: {
       identity: { name: { value: "Jane Doe", profile_evidence_ids: ["clm_1"] } },
       contact: {},
       employment: [],
     },
     handoff_manual_test_session_id: "hs_manual_test_1",
   });
   ```
4. Navigate a tab to a Greenhouse or Lever application form (or the repo's
   existing handoff fixture pages, if serving them locally — see
   `tests/` for fixture-serving setup from the already-merged handoff
   acceptance tests).
5. Click the extension's toolbar action icon on that tab.
6. Confirm in the page's own DevTools console: no errors, and any
   safe-catalog field (e.g. full name) gets autofilled.
7. Confirm in the service worker console: `chrome.storage.local.get("handoff_event_queue")`
   shows queued/flushed events consistent with what was filled.
8. This confirms the wiring works end-to-end against a real page. It does
   **not** confirm a real server round-trip succeeds unless a local
   JobSearch server is running on `127.0.0.1:8420` with a paired
   credential already set via `CredentialStore` — that's the larger manual
   release-gate test, not this ticket's scope.
