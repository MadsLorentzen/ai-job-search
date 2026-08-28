import { randomUUID } from "node:crypto";
import { promises as defaultFs } from "node:fs";
import { dirname, join } from "node:path";
import { loadDeskSession } from "./claude.mjs";

const SCHEMA_VERSION = 1;

export function conversationStorePath(workspace) {
  return join(workspace, ".claude", "desk", "conversations.json");
}

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeConversationId: null,
    conversations: {},
  };
}

function emptyConversation(id, seed = {}) {
  return {
    id,
    claudeSessionId: seed.claudeSessionId ?? null,
    events: [],
    nextSequence: 1,
    partialTurn: null,
    queue: [],
    artifacts: [],
    permissionMode: "safe",
    controller: "chat",
    controllerGeneration: 1,
    recoveryAttempts: 0,
    ...seed,
    id,
  };
}

function isSupportedState(value) {
  return Boolean(
    value
    && typeof value === "object"
    && value.schemaVersion === SCHEMA_VERSION
    && value.conversations
    && typeof value.conversations === "object",
  );
}

function corruptName(now) {
  return `conversations.corrupt-${now().toISOString().replace(/[:.]/g, "-")}.json`;
}

export function createConversationStore({
  workspace,
  fs = defaultFs,
  now = () => new Date(),
  createId = () => randomUUID(),
} = {}) {
  const path = conversationStorePath(workspace);
  let state = emptyState();
  let loaded = false;
  let chain = Promise.resolve();

  function serialize(work) {
    const run = chain.then(work, work);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async function persist() {
    const dir = dirname(path);
    await fs.mkdir(dir, { recursive: true });
    const tmp = join(dir, `conversations.${createId()}.tmp`);
    const body = `${JSON.stringify(state, null, 2)}\n`;
    await fs.writeFile(tmp, body);
    try {
      await fs.rename(tmp, path);
    } catch (error) {
      try { await fs.unlink(tmp); } catch { /* keep the original file */ }
      throw error;
    }
  }

  async function withRollback(work) {
    const previous = structuredClone(state);
    try {
      const result = await work();
      await persist();
      return result;
    } catch (error) {
      state = previous;
      throw error;
    }
  }

  async function quarantine(reason) {
    const dest = join(dirname(path), corruptName(now));
    try {
      await fs.rename(path, dest);
    } catch {
      // The original file may already be gone.
    }
    state = emptyState();
    loaded = true;
    return dest;
  }

  async function migrateLegacy() {
    const sessionId = loadDeskSession(workspace);
    if (!sessionId) return emptyState();
    const id = createId();
    const next = emptyState();
    next.conversations[id] = emptyConversation(id, { claudeSessionId: sessionId });
    next.activeConversationId = id;
    return next;
  }

  async function loadUnlocked() {
    try {
      const raw = await fs.readFile(path, "utf8");
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        await quarantine("parse");
        return state;
      }
      if (!isSupportedState(parsed)) {
        await quarantine("schema");
        return state;
      }
      state = parsed;
      loaded = true;
      return state;
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
      state = await migrateLegacy();
      loaded = true;
      if (state.activeConversationId) await persist();
      return state;
    }
  }

  async function ensureLoaded() {
    if (!loaded) await loadUnlocked();
  }

  return {
    load() {
      return serialize(loadUnlocked);
    },
    async createConversation(seed) {
      return serialize(async () => {
        await ensureLoaded();
        return withRollback(() => {
          const conversation = emptyConversation(createId(), seed);
          state.conversations[conversation.id] = conversation;
          state.activeConversationId = conversation.id;
          return conversation;
        });
      });
    },
    get(conversationId) {
      return state.conversations[conversationId] ?? null;
    },
    activeConversationId() {
      return state.activeConversationId;
    },
    transact(conversationId, mutator) {
      return serialize(async () => {
        await ensureLoaded();
        return withRollback(async () => {
          const current = structuredClone(state.conversations[conversationId]);
          if (!current) throw new Error(`Unknown conversation ${conversationId}`);
          await mutator(current);
          state.conversations[conversationId] = current;
          return current;
        });
      });
    },
    appendEvent(conversationId, draft) {
      return serialize(async () => {
        await ensureLoaded();
        return withRollback(() => {
          const conversation = state.conversations[conversationId];
          if (!conversation) throw new Error(`Unknown conversation ${conversationId}`);
          const persisted = {
            version: draft.version ?? 1,
            eventId: draft.eventId || createId(),
            conversationId,
            turnId: draft.turnId ?? conversation.partialTurn?.id ?? null,
            sequence: conversation.nextSequence,
            timestamp: draft.timestamp || now().toISOString(),
            type: draft.type,
            payload: draft.payload ?? {},
          };
          conversation.nextSequence += 1;
          conversation.events.push(persisted);
          if (typeof persisted.payload.sessionId === "string") {
            conversation.claudeSessionId = persisted.payload.sessionId;
          }
          if (persisted.type === "turn.started") conversation.partialTurn = { id: persisted.turnId, eventId: persisted.eventId };
          if (persisted.type === "turn.completed" || persisted.type === "turn.failed" || persisted.type === "turn.interrupted") {
            conversation.partialTurn = null;
          }
          return persisted;
        });
      });
    },
    eventsAfter(conversationId, sequence) {
      const conversation = state.conversations[conversationId];
      if (!conversation) return [];
      return conversation.events.filter((item) => item.sequence > sequence);
    },
    quarantine(reason) {
      return serialize(() => quarantine(reason));
    },
  };
}
