import {
  applySnapshot,
  createDeskState,
  markEntered,
  queueFollowUp,
  reduceDeskEvent,
} from "./event-store.js";
import {
  createArtifactViewState,
  moveArtifactSelection,
  renderArtifactView,
  requestArtifactConfirm,
} from "./artifact-view.js";
import { mountTabs } from "./tabs.js";
import { createTerminalView } from "./terminal-view.js";
import {
  filterCommands,
  renderChat,
  renderCommandForm,
  renderCommandInvocation,
  renderPaletteList,
  renderSidebar,
  valuesFromForm,
} from "./chat-view.js";

const logEl = document.getElementById("panel-chat");
const statusEl = document.getElementById("status");
const sessionEl = document.getElementById("session-label");
const workspaceEl = document.getElementById("workspace-label");
const modeEl = document.getElementById("mode-label");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const resetBtn = document.getElementById("reset");
const openCliBtn = document.getElementById("open-cli");
const form = document.getElementById("compose");
const sheet = document.getElementById("sheet");
const sheetForm = document.getElementById("sheet-form");
const sheetTitle = document.getElementById("sheet-title");
const sheetKicker = document.getElementById("sheet-kicker");
const sheetCopy = document.getElementById("sheet-copy");
const sheetFields = document.getElementById("sheet-fields");
const clockEl = document.getElementById("clock");
const menuBtn = document.getElementById("menu");
const scrim = document.getElementById("scrim");
const jumpBtn = document.getElementById("jump");
const stepsEl = document.querySelector(".steps");
const filesEl = document.getElementById("panel-files");
const palette = document.getElementById("palette");
const paletteQuery = document.getElementById("palette-query");
const paletteList = document.getElementById("palette-list");

let busy = false;
let sseSequence = 0;
let commands = [];
let activeCommand = null;
let runtimeSocket = null;
let state = createDeskState({ permissionMode: "autonomous" });
let artifactState = createArtifactViewState();
let stickToBottom = true;
let terminalView = null;
let terminalId = null;

function emptyMarkup(kind) {
  if (kind === "reset") {
    return `<div class="empty" id="empty">
      <p class="kicker">Clean slate</p>
      <h2>New conversation.</h2>
      <p>The page is clear. Your job-search files remain in the same workspace.</p>
      <div class="suggestions" aria-label="Suggested starts">
        <button type="button" data-action="scrape">Find openings</button>
        <button type="button" data-action="rank">Rank what we have</button>
        <button type="button" data-prompt="Which of these roles should I prioritize this week?">Prioritize this week</button>
      </div>
    </div>`;
  }
  return `<div class="empty" id="empty">
    <p class="kicker">Ready when you are</p>
    <h2>Start wherever you are.</h2>
    <p>First day in this repo? Run <strong>Setup</strong>. Profile already filled? <strong>Scrape</strong> for roles, then talk the same way you would in the terminal.</p>
    <div class="empty-actions">
      <button type="button" data-action="setup">Start with setup</button>
      <button type="button" data-action="scrape" class="ghost">I am already set up</button>
    </div>
    <div class="suggestions" aria-label="Suggested starts">
      <button type="button" data-prompt="Which of these roles should I prioritize this week?">Prioritize this week</button>
      <button type="button" data-action="rank">Rank what we have</button>
      <button type="button" data-action="interview">Prep for an interview</button>
    </div>
  </div>`;
}

function markdown(text) {
  if (window.marked && window.DOMPurify) {
    return window.DOMPurify.sanitize(window.marked.parse(text || "", { gfm: true, breaks: true }));
  }
  return String(text || "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`).replace(/\n/g, "<br>");
}

function bindDelegatedActions(root) {
  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (action) runAction(action.dataset.action);
    const prompt = event.target.closest("[data-prompt]");
    if (prompt) sendPrompt(prompt.dataset.prompt);
  });
}

function setMenu(open) {
  document.body.classList.toggle("menu-open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
  scrim.hidden = !open;
}

function nearBottom() {
  return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 96;
}

function scrollLog() {
  if (stickToBottom) logEl.scrollTop = logEl.scrollHeight;
  jumpBtn.hidden = stickToBottom || !logEl.querySelector("article");
}

function paintMode() {
  if (!modeEl) return;
  const label = state.permissionMode === "autonomous" ? "Autonomous" : "Safe";
  modeEl.textContent = label;
  modeEl.dataset.mode = state.permissionMode;
}

function paintChat() {
  renderChat(logEl, state, { markdown, emptyHtml: emptyMarkup(state.cards.size ? "reset" : undefined) });
  paintMode();
  scrollLog();
}

function setBusy(next) {
  busy = next;
  sendBtn.disabled = next && !runtimeSocket;
  stopBtn.hidden = !next;
  document.body.classList.toggle("working", next);
  document.body.setAttribute("aria-busy", String(next));
  statusEl.textContent = next ? "Claude is working" : "Ready";
}

function setWorkspaceLabel(root) {
  if (!workspaceEl || !root) return;
  workspaceEl.textContent = root;
  workspaceEl.title = "Desk and Claude Code both write scrapes, CVs, and applications here";
}

function setSessionLabel(data = {}) {
  setWorkspaceLabel(data.workspace);
  if (data.chromeGroup) {
    sessionEl.textContent = data.sessionId
      ? `${data.chromeGroup} · Chrome group`
      : `${data.chromeGroup} · waiting for Chrome`;
    return;
  }
  sessionEl.textContent = data.sessionId ? `Session ${data.sessionId.slice(0, 8)}` : "New session";
}

function sizePrompt() {
  promptEl.style.height = "auto";
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 192)}px`;
}

function markAction(name) {
  document.querySelectorAll(".steps [data-action]").forEach((button) => {
    button.classList.toggle("active", button.dataset.action === name);
  });
}

function paintFiles() {
  renderArtifactView(filesEl, artifactState);
}

function ingest(event) {
  state = reduceDeskEvent(state, event);
  paintChat();
  if (event.type === "artifact.discovered") {
    const incoming = {
      id: event.payload.artifactId || event.payload.entityId,
      turnId: event.payload.turnId || event.turnId,
      relativePath: event.payload.relativePath,
      kind: event.payload.kind,
      mime: event.payload.mime,
    };
    artifactState = createArtifactViewState({
      ...artifactState,
      status: "ready",
      artifacts: [...artifactState.artifacts.filter((item) => item.id !== incoming.id), incoming],
      selectedId: artifactState.selectedId || incoming.id,
    });
    paintFiles();
  }
}

async function loadArtifacts() {
  artifactState = createArtifactViewState({ ...artifactState, status: "loading" });
  paintFiles();
  try {
    const res = await fetch("/artifacts");
    if (!res.ok) throw new Error("Could not load artifacts.");
    const body = await res.json();
    artifactState = createArtifactViewState({
      artifacts: body.artifacts || [],
      selectedId: artifactState.selectedId,
    });
  } catch (error) {
    artifactState = createArtifactViewState({ status: "error", error: error.message });
  }
  paintFiles();
}

async function showArtifactPreview(id) {
  const res = await fetch(`/artifacts/${id}/preview`);
  if (!res.ok) throw new Error("Could not preview that file.");
  const type = res.headers.get("content-type") || "";
  let preview;
  if (type.includes("text/html")) preview = { kind: "html", src: `/artifacts/${id}/preview` };
  else if (type.includes("application/pdf")) preview = { kind: "pdf", src: `/artifacts/${id}/preview` };
  else if (type.startsWith("image/")) preview = { kind: "image", src: `/artifacts/${id}/preview` };
  else if (type.includes("json")) preview = await res.json();
  else preview = { kind: "text", text: await res.text() };
  artifactState = { ...artifactState, selectedId: id, preview, confirm: null };
  paintFiles();
}

async function showArtifactCompare(id) {
  const res = await fetch(`/artifacts/${id}/compare`);
  if (!res.ok) throw new Error("Could not compare that file.");
  artifactState = { ...artifactState, selectedId: id, compare: await res.json(), confirm: null };
  paintFiles();
}

async function confirmArtifactAction() {
  const confirm = artifactState.confirm;
  if (!confirm) return;
  await post(`/artifacts/${confirm.id}/${confirm.action}`, {
    expectedControllerGeneration: state.controllerGeneration,
  });
  artifactState = { ...artifactState, confirm: null };
  paintFiles();
}

function sseEvent(type, payload) {
  sseSequence += 1;
  ingest({
    eventId: `sse-${sseSequence}`,
    sequence: Math.max(state.lastSequence + 1, sseSequence),
    turnId: "print",
    type,
    payload,
  });
}

async function post(path, body) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
}

function runtimeSend(message) {
  if (!runtimeSocket || runtimeSocket.readyState !== WebSocket.OPEN) return false;
  runtimeSocket.send(JSON.stringify({
    ...message,
    expectedControllerGeneration: state.controllerGeneration,
    conversationId: state.conversationId,
  }));
  return true;
}

async function sendPrompt(prompt) {
  const text = prompt.trim();
  if (!text) return false;
  if (busy && runtimeSocket) {
    const messageId = `q-${Date.now()}`;
    state = queueFollowUp(state, { messageId, text });
    paintChat();
    runtimeSend({ type: "user.message", messageId, text });
    return true;
  }
  if (busy) return false;
  if (!lastHealth?.loggedIn) {
    try {
      lastHealth = await readHealth();
    } catch {
      // Keep the last known status if the health endpoint blips.
    }
  }
  if (needsInstall(lastHealth) || needsLogin(lastHealth) || !lastHealth?.installed) {
    applyHealth(lastHealth || { installed: false });
    if (!lastHealth?.installed && !needsInstall(lastHealth) && !needsLogin(lastHealth)) {
      sseEvent("turn.failed", { text: "Claude Code is not installed yet. Use the Connect Claude button." });
    }
    return false;
  }
  setMenu(false);
  setBusy(true);
  const messageId = `m-${Date.now()}`;
  if (runtimeSend({ type: "user.message", messageId, text })) {
    sseEvent("user.message", { messageId, text });
    return true;
  }
  try {
    sseEvent("user.message", { text });
    const res = await post("/send", { prompt: text });
    if (!res.ok) throw new Error();
    return true;
  } catch {
    setBusy(false);
    sseEvent("turn.failed", { text: "The desk could not reach the local server. Is the terminal still running?" });
    return false;
  }
}

function runAction(name) {
  const command = commands.find((item) => item.id === name);
  markAction(name);
  setMenu(false);
  if (!command) {
    if (name === "setup") sendPrompt("/setup");
    else if (name === "rank") sendPrompt("/rank");
    else if (name === "interview") sendPrompt("/interview");
    else if (name === "outcome") sendPrompt("/outcome");
    return;
  }
  if (!command.arguments?.length) {
    sendPrompt(command.invocation);
    return;
  }
  openCommandSheet(command);
}

function openCommandSheet(command) {
  activeCommand = command;
  sheetKicker.textContent = command.invocation;
  sheetTitle.textContent = command.title;
  sheetCopy.textContent = command.description || "Fill the fields you need, then run.";
  sheetFields.innerHTML = renderCommandForm(command);
  sheet.showModal();
  sheetFields.querySelector("input, textarea, select")?.focus();
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function tickClock() {
  const now = new Date();
  clockEl.dateTime = now.toISOString();
  clockEl.textContent = formatTime(now);
}

function rememberSession(data) {
  if (data.chromeGroup) sessionEl.dataset.chromeGroup = data.chromeGroup;
  if (data.sessionId) sessionEl.dataset.sessionId = data.sessionId;
  else delete sessionEl.dataset.sessionId;
  setSessionLabel(data);
}

function openPalette() {
  palette.showModal();
  paletteQuery.value = "";
  renderPaletteList(paletteList, commands);
  paletteQuery.focus();
}

function connectRuntime() {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.addEventListener("open", () => {
    runtimeSocket = socket;
    socket.send(JSON.stringify({
      type: "hello",
      conversationId: state.conversationId || "active",
      protocolVersion: 1,
      afterSequence: state.lastSequence,
    }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "snapshot") {
      state = applySnapshot(state, message.snapshot || {});
      paintChat();
    } else if (message.type === "event" && message.event) {
      ingest(message.event);
    }
  });
  socket.addEventListener("close", () => {
    if (runtimeSocket === socket) runtimeSocket = null;
  });
  socket.addEventListener("error", () => {
    socket.close();
  });
}

const source = new EventSource("/events");
source.addEventListener("hello", (event) => {
  const data = JSON.parse(event.data);
  setBusy(Boolean(data.busy));
  rememberSession(data);
  if (Array.isArray(data.transcript) && data.transcript.length && !state.cards.size) {
    for (const entry of data.transcript) {
      const type = entry.role === "assistant" ? "assistant.message" : entry.role === "user" ? "user.message" : "turn.failed";
      sseEvent(type, { text: entry.text || "" });
    }
  }
});
source.addEventListener("session", (event) => rememberSession(JSON.parse(event.data)));
source.addEventListener("user", (event) => {
  if (!runtimeSocket) sseEvent("user.message", { text: JSON.parse(event.data).text });
});
source.addEventListener("delta", (event) => {
  if (!runtimeSocket) sseEvent("assistant.delta", { text: JSON.parse(event.data).text });
});
source.addEventListener("result", (event) => {
  if (!runtimeSocket) sseEvent("turn.completed", { text: JSON.parse(event.data).text || "" });
});
source.addEventListener("tool", (event) => {
  if (runtimeSocket) return;
  const { name, phase } = JSON.parse(event.data);
  sseEvent(phase === "start" ? "tool.started" : "tool.completed", { toolUseId: `tool-${name}`, name });
});
source.addEventListener("status", (event) => {
  statusEl.textContent = JSON.parse(event.data).text;
});
source.addEventListener("log", (event) => {
  statusEl.textContent = JSON.parse(event.data).text.slice(0, 180);
});
source.addEventListener("turn-error", (event) => {
  if (event.data && !runtimeSocket) sseEvent("turn.failed", { text: JSON.parse(event.data).text });
});
source.addEventListener("autofill-review", (event) => {
  const payload = JSON.parse(event.data);
  sseEvent("autofill.review", payload);
});
source.addEventListener("idle", () => {
  setBusy(false);
  state = applySnapshot(state, { busy: false });
  paintChat();
});
source.onerror = (event) => {
  if (event?.data) return;
  statusEl.textContent = "Lost the local server. Run node gui/server.mjs again.";
};

if (openCliBtn) {
  openCliBtn.addEventListener("click", async () => {
    openCliBtn.disabled = true;
    try {
      const res = await fetch("/workspace/cli", { method: "POST" });
      const data = await res.json();
      statusEl.textContent = data.error || `Claude Code opened in ${data.root}`;
    } catch {
      statusEl.textContent = "Could not open Claude Code in this folder.";
    } finally {
      openCliBtn.disabled = false;
    }
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = promptEl.value;
  promptEl.value = "";
  sizePrompt();
  const sent = await sendPrompt(value);
  if (!sent && !promptEl.value) {
    promptEl.value = value;
    sizePrompt();
  }
  promptEl.focus();
});

promptEl.addEventListener("input", sizePrompt);
promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

sheetForm.addEventListener("submit", (event) => {
  if (event.submitter?.value !== "run") return;
  if (!activeCommand) return;
  const prompt = renderCommandInvocation(activeCommand, valuesFromForm(sheetFields));
  if (!prompt || prompt === activeCommand.invocation && activeCommand.arguments.some((argument) => argument.kind === "url")) {
    const values = valuesFromForm(sheetFields);
    const needsUrl = activeCommand.arguments.some((argument) => argument.kind === "url");
    if (needsUrl && !values.url && !values.posting) {
      event.preventDefault();
      statusEl.textContent = "Add a URL or paste the posting.";
      return;
    }
  }
  sendPrompt(renderCommandInvocation(activeCommand, valuesFromForm(sheetFields)));
});

stopBtn.addEventListener("click", () => {
  if (!runtimeSend({ type: "turn.interrupt" })) post("/stop");
});
resetBtn.addEventListener("click", async () => {
  if (!window.confirm("Start a new conversation? The current chat is cleared.")) return;
  if (!runtimeSend({ type: "conversation.reset" })) await post("/reset");
  state = createDeskState({ permissionMode: state.permissionMode });
  sseSequence = 0;
  paintChat();
  jumpBtn.hidden = true;
  setSessionLabel({ chromeGroup: sessionEl.dataset.chromeGroup, sessionId: sessionEl.dataset.sessionId });
});

menuBtn.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));
scrim.addEventListener("click", () => setMenu(false));
jumpBtn.addEventListener("click", () => {
  stickToBottom = true;
  scrollLog();
});
logEl.addEventListener("scroll", () => {
  stickToBottom = nearBottom();
  jumpBtn.hidden = stickToBottom || !logEl.querySelector("article");
}, { passive: true });

logEl.addEventListener("submit", (event) => {
  const formNode = event.target.closest("form.interaction");
  if (!formNode) return;
  event.preventDefault();
  const id = formNode.dataset.id;
  runtimeSend({ type: "question.response", requestId: id, answers: valuesFromForm(formNode) });
  state = markEntered(state, id);
  paintChat();
});

logEl.addEventListener("click", (event) => {
  const decision = event.target.closest("[data-decision]");
  if (!decision) return;
  const root = decision.closest("[data-id]");
  const id = root?.dataset.id;
  if (root?.dataset.kind === "autofill") {
    post("/autofill/decide", {
      reviewId: id,
      token: root.dataset.token,
      decision: decision.dataset.decision,
      expectedControllerGeneration: state.controllerGeneration,
      conversationId: state.conversationId,
    });
    state = markEntered(state, id);
    paintChat();
    return;
  }
  runtimeSend({ type: "permission.decision", requestId: id, decision: decision.dataset.decision });
  state = markEntered(state, id);
  paintChat();
});

paletteQuery?.addEventListener("input", () => {
  renderPaletteList(paletteList, filterCommands(commands, paletteQuery.value));
});
paletteList?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-command]");
  if (!item) return;
  palette.close();
  runAction(item.dataset.command);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMenu(false);
    return;
  }
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    event.preventDefault();
    promptEl.focus();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openPalette();
  }
});

async function ensureTerminal() {
  const host = document.getElementById("panel-terminal");
  const bridge = window.deskApp?.terminal;
  if (!host || !bridge || terminalView) {
    terminalView?.focus();
    return;
  }
  let Terminal;
  let FitAddon;
  try {
    ({ Terminal } = await import("@xterm/xterm"));
    ({ FitAddon } = await import("@xterm/addon-fit"));
  } catch {
    host.innerHTML = `<div class="empty"><p class="kicker">Terminal</p><h2>Claude Code, same conversation.</h2><p>The embedded terminal is available in the installable Desk.</p></div>`;
    return;
  }
  host.innerHTML = "";
  const xtermHost = document.createElement("div");
  xtermHost.className = "xterm-host";
  host.append(xtermHost);
  terminalView = createTerminalView({
    terminalFactory: () => new Terminal({ convertEol: true, cursorBlink: true, fontFamily: "IBM Plex Mono, ui-monospace, monospace" }),
    fitAddonFactory: () => new FitAddon(),
    bridge: {
      write(data) { if (terminalId) bridge.write({ terminalId, data }); },
      resize({ cols, rows }) { if (terminalId) bridge.resize({ terminalId, cols, rows }); },
    },
  });
  terminalView.mount(xtermHost);
  bridge.onData((payload) => {
    if (payload?.data) terminalView.write(payload.data);
  });
  bridge.onExit(() => {
    terminalView.setInputEnabled(false);
  });
  const started = await bridge.start({
    expectedControllerGeneration: state.controllerGeneration,
    cols: 80,
    rows: 24,
  });
  if (!started?.ok) {
    terminalView.dispose();
    terminalView = null;
    host.innerHTML = `<div class="empty"><p class="kicker">Terminal</p><h2>Could not attach Claude.</h2><p>Stay in Chat. Open CLI still works for the same workspace.</p></div>`;
    return;
  }
  terminalId = started.terminalId;
  state = applySnapshot(state, started.snapshot || { controller: "terminal" });
  terminalView.focus();
}

bindDelegatedActions(document);
mountTabs(document.getElementById("surface-tabs"), {
  selectedId: "chat",
  onSelect(id) {
    if (id === "files") loadArtifacts();
    if (id === "terminal") ensureTerminal();
  },
});
filesEl.addEventListener("click", (event) => {
  const item = event.target.closest("[data-artifact-id]");
  if (item) {
    artifactState = { ...artifactState, selectedId: item.dataset.artifactId, confirm: null };
    showArtifactPreview(item.dataset.artifactId).catch((error) => {
      artifactState = { ...artifactState, error: error.message, status: "error" };
      paintFiles();
    });
    return;
  }
  const action = event.target.closest("[data-artifact-action]");
  if (action && artifactState.selectedId) {
    if (action.dataset.artifactAction === "preview") showArtifactPreview(artifactState.selectedId);
    else if (action.dataset.artifactAction === "compare") showArtifactCompare(artifactState.selectedId);
    else artifactState = requestArtifactConfirm(artifactState, action.dataset.artifactAction);
    paintFiles();
    return;
  }
  const decision = event.target.closest("[data-confirm]");
  if (decision?.dataset.confirm === "yes") confirmArtifactAction();
  else if (decision?.dataset.confirm === "no") {
    artifactState = { ...artifactState, confirm: null };
    paintFiles();
  }
});
filesEl.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    artifactState = moveArtifactSelection(artifactState, event.key === "ArrowDown" ? 1 : -1);
    paintFiles();
  }
});
paintChat();
paintFiles();

fetch("/commands")
  .then((res) => res.json())
  .then((data) => {
    commands = data.commands || [];
    if (commands.length) renderSidebar(stepsEl, commands);
  })
  .catch(() => {});

connectRuntime();

const gate = document.getElementById("gate");
const gateTitle = document.getElementById("gate-title");
const gateCopy = document.getElementById("gate-copy");
const gateLog = document.getElementById("gate-log");
const gateAction = document.getElementById("gate-action");
const gateCancel = document.getElementById("gate-cancel");
const gateCodeWrap = document.getElementById("gate-code-wrap");
const gateCode = document.getElementById("gate-code");
const gateChrome = document.getElementById("gate-chrome");
const accountLabel = document.getElementById("account-label");

let authWaiter = null;
let lastHealth = null;

function setGate(open, title, copy) {
  document.body.classList.toggle("gated", open);
  gate.hidden = !open;
  gate.inert = !open;
  gate.setAttribute("aria-hidden", String(!open));
  if (title) gateTitle.textContent = title;
  if (copy) gateCopy.textContent = copy;
  if (open) setMenu(false);
}

function appendGateLog(text) {
  gateLog.hidden = false;
  gateLog.textContent = `${gateLog.textContent}${gateLog.textContent ? "\n" : ""}${text}`.slice(-2000);
  gateLog.scrollTop = gateLog.scrollHeight;
}

function needsInstall(health) {
  return Boolean(health) && health.installed === false && !health.error;
}

function needsLogin(health) {
  return Boolean(health?.installed && health.loggedIn === false && !health.error);
}

function describeAccount(health) {
  if (health?.loggedIn) {
    const plan = health.subscriptionType ? ` · ${health.subscriptionType}` : "";
    return health.email ? `${health.email}${plan}` : `Signed in${plan}`;
  }
  if (health?.error) return "Claude status unknown";
  if (needsLogin(health)) return "Signed out";
  return "localhost only";
}

function waitForAuth(kind) {
  return new Promise((resolve) => {
    authWaiter = { kind, resolve };
  });
}

async function readHealth() {
  const res = await fetch("/auth/status");
  if (!res.ok) throw new Error("Could not read Claude status.");
  return res.json();
}

function applyHealth(health) {
  lastHealth = health;
  accountLabel.textContent = describeAccount(health);
  accountLabel.classList.toggle("signed-in", Boolean(health?.loggedIn));
  gateCancel.hidden = true;
  gateCodeWrap.hidden = true;
  if (health.loggedIn) {
    setGate(false);
    return true;
  }
  if (needsInstall(health)) {
    setGate(true, "Install Claude Code", "The desk uses Claude Code on this machine. One click runs Anthropic's official installer, then signs you in with the same Claude account you use in Chrome.");
    gateAction.textContent = "Install and sign in";
    return false;
  }
  if (needsLogin(health)) {
    setGate(true, "Sign in with Claude", "A browser window will open on claude.ai. Use the same email as your Chrome Claude subscription (Pro, Max, Team, or Enterprise). API keys are not required.");
    gateAction.textContent = "Sign in with Claude";
    return false;
  }
  setGate(false);
  return true;
}

async function bootstrapClaude() {
  gateAction.disabled = true;
  gateCancel.hidden = false;
  try {
    let health = await readHealth();
    if (needsInstall(health)) {
      appendGateLog("Installing Claude Code with the official installer.");
      const res = await post("/auth/install");
      if (!res.ok) throw new Error("Install is already running.");
      const done = await waitForAuth("install");
      if (!done.ok) throw new Error(done.error || "Claude Code did not install.");
      health = done.health || (await readHealth());
    }
    if (needsLogin(health)) {
      appendGateLog("Opening the claude.ai login. Finish it in the browser, then return here.");
      const res = await post("/auth/login");
      if (!res.ok) throw new Error("Login is already running.");
      const done = await waitForAuth("login");
      if (!done.ok) throw new Error(done.error || "Claude login did not finish.");
      health = done.health || (await readHealth());
    }
    if (health.loggedIn || (!needsLogin(health) && !needsInstall(health))) {
      applyHealth(health);
      return;
    }
    throw new Error("Claude is installed but still signed out. Try Sign in again.");
  } catch (err) {
    appendGateLog(err.message);
    gateTitle.textContent = "Could not connect";
    gateCopy.textContent = err.message;
  } finally {
    gateAction.disabled = false;
    gateCancel.hidden = Boolean(gate.hidden);
  }
}

source.addEventListener("auth-log", (event) => appendGateLog(JSON.parse(event.data).text));
source.addEventListener("auth-url", (event) => {
  const url = JSON.parse(event.data).url;
  appendGateLog(`Open this login page if the browser did not appear:\n${url}`);
  window.open(url, "_blank", "noopener");
});
source.addEventListener("auth-code", () => {
  gateCodeWrap.hidden = false;
  gateCode.focus();
});
source.addEventListener("auth-done", (event) => {
  const data = JSON.parse(event.data);
  if (authWaiter && (authWaiter.kind === data.kind || data.kind === "cancel")) {
    const { resolve } = authWaiter;
    authWaiter = null;
    resolve(data);
  }
  if (data.health) applyHealth(data.health);
});

gateAction.addEventListener("click", () => bootstrapClaude());
gateCancel.addEventListener("click", () => post("/auth/cancel"));
gateCode.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const code = gateCode.value.trim();
  if (!code) return;
  post("/auth/code", { code });
  gateCode.value = "";
});

fetch("/auth/meta")
  .then((res) => res.json())
  .then((meta) => {
    if (meta.chromeExtensionUrl) gateChrome.href = meta.chromeExtensionUrl;
  })
  .catch(() => {});

readHealth()
  .then(applyHealth)
  .catch(() => {
    setGate(false);
    accountLabel.textContent = "Claude status unknown";
  });

tickClock();
window.setInterval(tickClock, 30000);
sizePrompt();
promptEl.focus();
