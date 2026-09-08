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
import { filterJobs, renderApplications, renderChecklist, renderJobs, renderTools } from "./desk-views.js";
import { createTerminalView } from "./terminal-view.js";
import {
  answersFromQuestionForm,
  commandInputError,
  commandNeedsInput,
  questionAnswersError,
  filterCommands,
  renderChat,
  renderCommandForm,
  renderCommandInvocation,
  renderPaletteList,
  renderSidebar,
  valuesFromForm,
} from "./chat-view.js";

const logEl = document.getElementById("panel-chat");
const announceEl = document.getElementById("announce");
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
const sheetError = document.getElementById("sheet-error");
const clockEl = document.getElementById("clock");
const menuBtn = document.getElementById("menu");
const scrim = document.getElementById("scrim");
const jumpBtn = document.getElementById("jump");
const stepsEl = document.querySelector(".steps");
const dock = document.getElementById("dock");
const filesEl = document.getElementById("panel-files");
const jobsEl = document.getElementById("panel-jobs");
const applicationsEl = document.getElementById("panel-applications");
const toolsDialog = document.getElementById("tools");
const toolsList = document.getElementById("tools-list");
const modeSheet = document.getElementById("mode-sheet");
const modeToggle = document.getElementById("mode-toggle");
const docInput = document.getElementById("doc-input");
const dropzone = document.getElementById("dropzone");
const palette = document.getElementById("palette");
const paletteQuery = document.getElementById("palette-query");
const paletteList = document.getElementById("palette-list");

let busy = false;
let sseSequence = 0;
let sseTurn = 0;
let sseTurnClosed = true;
let sendPending = false;
let replayingTranscript = false;
let commands = [];
let activeCommand = null;
let runtimeSocket = null;
let state = createDeskState({ permissionMode: "autonomous" });
let artifactState = createArtifactViewState();
let stickToBottom = true;
let terminalView = null;
let terminalId = null;
// True once the installed app's runtime has spoken over the WebSocket; the
// print-mode event stream must not repaint the page after that.
let runtimeMode = false;
let hasReset = false;

const REJECT_TEXT = {
  full: "Claude is still working on the last message. Wait for it to finish, or press Stop.",
  busy: "Claude is still working on the last message. Wait for it to finish, or press Stop.",
  "stale-controller": "The desk was out of step for a moment. Please try that again.",
  "wrong-controller": "The Terminal tab has the conversation right now. Switch back to Chat first.",
  "handoff-in-progress": "The desk is switching tabs. Try again in a moment.",
  closed: "Claude is not running. Start a new chat.",
  "unknown-request": "That question has already been answered, or it expired.",
  malformed: "Answer every question before sending.",
  error: "Something went wrong inside the desk while doing that. Try again; if it keeps happening, start a new chat.",
};

function notice(text) {
  const last = [...state.cards.values()].at(-1);
  if (last?.type === "desk.notice" && last.payload.text === text) return;
  sseEvent("desk.notice", { text });
}

function syncBusy() {
  if (state.busy !== busy) setBusy(state.busy);
}

function emptyMarkup(kind) {
  if (kind === "reset") {
    return `<div class="empty" id="empty">
      <p class="kicker">Clean slate</p>
      <h2>New conversation.</h2>
      <p>The page is clear. Your files are still in your job-search folder.</p>
      ${renderChecklist(progressInfo, toolsInfo)}
      <div class="suggestions" aria-label="Suggested starts">
        <button type="button" data-action="scrape">Find openings</button>
        <button type="button" data-action="rank">Rank what we have</button>
        <button type="button" data-prompt="Which of these roles should I prioritize this week?">Prioritize this week</button>
      </div>
    </div>`;
  }
  const checklist = renderChecklist(progressInfo, toolsInfo);
  return `<div class="empty" id="empty">
    <p class="kicker">Ready when you are</p>
    <h2>Start wherever you are.</h2>
    <p>New here? Start with <strong>Setup</strong>: it asks a few questions about you, once. Already set up? Click <strong>Find jobs</strong> to search the job boards, or just type what you need below.</p>
    ${checklist || `<div class="empty-actions">
      <button type="button" data-action="setup">Start with setup</button>
      <button type="button" data-action="scrape" class="ghost">Find jobs now</button>
    </div>`}
    <div class="suggestions" aria-label="Suggested starts">
      <button type="button" data-prompt="Which of these roles should I prioritize this week?">Prioritize this week</button>
      <button type="button" data-action="rank">Rank what we have</button>
      <button type="button" data-action="interview">Prep for an interview</button>
    </div>
  </div>`;
}

let purifyHooked = false;
function markdown(text) {
  if (window.marked && window.DOMPurify) {
    if (!purifyHooked) {
      purifyHooked = true;
      window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName === "A" && node.getAttribute("href")) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      });
    }
    return window.DOMPurify.sanitize(window.marked.parse(text || "", { gfm: true, breaks: true }), {
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ["img", "svg", "picture", "video", "audio", "form", "input", "button", "select", "textarea", "label", "style", "details", "summary", "dialog"],
      FORBID_ATTR: ["class", "id", "style"],
    });
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

function jumpToLatest() {
  stickToBottom = true;
  logEl.scrollTo({ top: logEl.scrollHeight, behavior: "smooth" });
  jumpBtn.hidden = true;
}

function paintMode() {
  if (!modeEl) return;
  const autonomous = state.permissionMode === "autonomous";
  modeEl.textContent = autonomous ? "Works on its own" : "Asks before acting";
  modeEl.title = autonomous
    ? "Claude may create and change files in your job-search folder without asking first."
    : "Claude asks you before changing files or running commands.";
  modeEl.dataset.mode = state.permissionMode;
}

function announce(text) {
  if (!announceEl) return;
  announceEl.textContent = "";
  window.setTimeout(() => { announceEl.textContent = text; }, 50);
}

function paintChat() {
  paintScheduled = false;
  renderChat(logEl, state, { markdown, emptyHtml: emptyMarkup(hasReset ? "reset" : undefined) });
  paintMode();
  scrollLog();
}

// Streaming used to paint on every token, and each paint re-ran markdown over
// the whole reply, so a long answer froze the page. Now at most one paint per
// frame.
let paintScheduled = false;
function schedulePaint() {
  if (paintScheduled) return;
  paintScheduled = true;
  if (document.hidden || typeof requestAnimationFrame !== "function") window.setTimeout(paintChat, 60);
  else requestAnimationFrame(paintChat);
}

function setBusy(next) {
  busy = next;
  sendBtn.disabled = next && !runtimeSocket;
  stopBtn.hidden = !next;
  document.body.classList.toggle("working", next);
  statusEl.textContent = next ? "Claude is working. Stop cancels this turn." : "Ready";
}

function setWorkspaceLabel(root) {
  if (!workspaceEl || !root) return;
  workspaceEl.textContent = root;
  workspaceEl.title = "Your job-search folder. Everything Claude finds or writes is saved here.";
}

function setSessionLabel(data = {}) {
  setWorkspaceLabel(data.workspace);
  if (data.chromeGroup) {
    sessionEl.textContent = data.sessionId
      ? `${data.chromeGroup} · Chrome group`
      : `${data.chromeGroup} · waiting for Chrome`;
    return;
  }
  if (data.restored) sessionEl.textContent = "Continuing from last time";
  else if (!data.sessionId) sessionEl.textContent = "New conversation";
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
  const wasBusy = state.busy;
  state = reduceDeskEvent(state, event);
  if (event.type === "assistant.delta" || event.type === "assistant.thinking") schedulePaint();
  else paintChat();
  if (!replayingTranscript && state.busy !== wasBusy) setBusy(state.busy);
  if (!replayingTranscript) {
    if (event.type === "turn.completed") announce("Claude replied.");
    else if (event.type === "turn.failed") announce(`Problem: ${event.payload?.text || "the turn failed."}`);
    else if (event.type === "question.requested") announce("Claude has a question for you.");
    else if (event.type === "permission.requested") announce("Claude is asking for permission.");
    if (event.type === "turn.completed" || event.type === "turn.failed") {
      notifyHidden(event.type === "turn.completed" ? "Claude finished." : "Claude ran into a problem.");
      refreshDeskData();
    } else if (event.type === "question.requested") notifyHidden("Claude has a question for you.");
    else if (event.type === "permission.requested") notifyHidden("Claude is asking for permission.");
  }
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
  try {
    const res = await post(`/artifacts/${confirm.id}/${confirm.action}`, {
      expectedControllerGeneration: state.controllerGeneration,
    });
    if (!res.ok) {
      artifactState = { ...artifactState, status: "error", error: "Could not complete that action." };
      paintFiles();
      return;
    }
  } catch {
    artifactState = { ...artifactState, status: "error", error: "Could not complete that action." };
    paintFiles();
    return;
  }
  artifactState = { ...artifactState, confirm: null };
  paintFiles();
}

function sseEvent(type, payload) {
  sseSequence += 1;
  if (type === "user.message" || type === "assistant.message") {
    sseTurn += 1;
    sseTurnClosed = false;
  } else if (type === "assistant.delta") {
    if (sseTurnClosed) {
      sseTurn += 1;
      sseTurnClosed = false;
    }
  } else if (type === "turn.completed" || type === "turn.failed" || type === "turn.interrupted") {
    sseTurnClosed = true;
  }
  ingest({
    eventId: `sse-${sseSequence}`,
    sequence: sseSequence,
    local: true,
    turnId: `turn-${sseTurn}`,
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
  if (busy) {
    lastSendError = closingOld
      ? "Still closing the old conversation. Try again in a moment."
      : REJECT_TEXT.busy;
    notice(lastSendError);
    return false;
  }
  if (sendPending) return false;
  lastSendError = "";
  sendPending = true;
  try {
    if (!lastHealth?.loggedIn) {
      try {
        lastHealth = await readHealth();
      } catch {
        // Keep the last known status if the health endpoint blips.
      }
    }
    if (needsInstall(lastHealth) || needsLogin(lastHealth) || !lastHealth?.installed) {
      lastSendError = "Claude Code needs to be set up first. Follow the steps on screen.";
      applyHealth(lastHealth || { installed: false });
      if (!lastHealth?.installed && !needsInstall(lastHealth) && !needsLogin(lastHealth)) {
        sseEvent("turn.failed", { text: "Claude Code is not installed yet. Use the Connect Claude button." });
      }
      return false;
    }
    setMenu(false);
    setBusy(true);
    requestNotificationPermission();
    // The server echoes the message back (runtime: a persisted user.message
    // event; print mode: the "user" SSE event), so the page does not add its
    // own copy. A local copy showed every message twice.
    const messageId = `m-${Date.now()}`;
    if (runtimeSend({ type: "user.message", messageId, text })) {
      inFlightSends.set(messageId, text);
      return true;
    }
    if (runtimeMode) {
      setBusy(false);
      lastSendError = "The desk is reconnecting to Claude. Try again in a moment.";
      notice(lastSendError);
      return false;
    }
    let res;
    try {
      res = await post("/send", { prompt: text });
    } catch {
      setBusy(false);
      lastSendError = "The desk cannot reach its local server. Close this tab and open the desk again.";
      sseEvent("turn.failed", { text: lastSendError });
      return false;
    }
    if (res.ok) return true;
    const body = await res.json().catch(() => ({}));
    if (!state.busy) setBusy(false);
    lastSendError = sendErrorText(res.status, body.error);
    notice(lastSendError);
    return false;
  } finally {
    sendPending = false;
  }
}

function sendErrorText(status, reason) {
  if (status === 409 || reason === "busy") return REJECT_TEXT.busy;
  if (status === 413) return "That message is too long to send. Paste a shorter posting.";
  if (status === 400) return "The desk could not send an empty message.";
  return "The desk could not send that message. Try again, and if it keeps happening close this tab and open the desk again.";
}

function handleRejected(message) {
  const reason = message.reason || "rejected";
  if (reason === "duplicate") return;
  if (message.command === "user.message" || !message.command) {
    if (message.messageId) {
      state = { ...state, queued: state.queued.filter((item) => item.id !== message.messageId) };
      // Give the words back rather than making the person retype them.
      const text = inFlightSends.get(message.messageId);
      inFlightSends.delete(message.messageId);
      if (text && !promptEl.value.trim()) {
        promptEl.value = text;
        sizePrompt();
      }
    }
    if (!state.busy) setBusy(false);
  } else if (message.requestId && state.cards.has(message.requestId)) {
    // Let the person answer or decide again, and keep the page in
    // "waiting for you" rather than "Working".
    const next = structuredClone(state);
    const card = next.cards.get(message.requestId);
    card.entered = false;
    if (card.type === "question.requested") next.pendingQuestionId = message.requestId;
    if (card.type === "permission.requested") next.pendingPermissionId = message.requestId;
    state = next;
    paintChat();
  }
  notice(REJECT_TEXT[reason] || `The desk could not do that (${reason}).`);
}

async function runStep(name, prompt) {
  const sent = await sendPrompt(prompt);
  if (sent) {
    markAction(name);
    tabs?.select("chat");
  }
  return sent;
}

function runAction(name) {
  const command = commands.find((item) => item.id === name);
  setMenu(false);
  if (command && commandNeedsInput(command)) {
    // Pasting can happen while Claude works; Run explains if it must wait.
    openCommandSheet(command);
    return;
  }
  if (busy && !runtimeSocket) {
    notice(closingOld ? "Still closing the old conversation. Try again in a moment." : REJECT_TEXT.busy);
    return;
  }
  if (!command) {
    if (["setup", "rank", "interview", "outcome"].includes(name)) runStep(name, `/${name}`);
    return;
  }
  if (!commandNeedsInput(command)) {
    runStep(name, command.invocation);
    return;
  }
  openCommandSheet(command);
}

function openCommandSheet(command) {
  activeCommand = command;
  if (command.id === "setup") {
    sheetKicker.textContent = "/setup";
    sheetTitle.textContent = "Build your profile";
    sheetCopy.textContent = "Fill what you know. Claude asks only for the rest. Add a CV first if you have one.";
  } else {
    sheetKicker.textContent = command.invocation;
    sheetTitle.textContent = command.title;
    sheetCopy.textContent = command.description || "Add what the step needs, then run.";
  }
  sheetFields.innerHTML = renderCommandForm(command);
  sheetError.hidden = true;
  sheetError.textContent = "";
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
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "snapshot") {
      if (!runtimeMode) {
        runtimeMode = true;
        if (modeToggle) modeToggle.hidden = false;
        state = createDeskState({ permissionMode: state.permissionMode });
        sseSequence = 0;
        sseTurn = 0;
        sseTurnClosed = true;
      }
      state = applySnapshot(state, message.snapshot || {});
      syncBusy();
      paintChat();
    } else if (message.type === "event" && message.event) {
      ingest(message.event);
    } else if (message.type === "command.accepted") {
      if (message.messageId) inFlightSends.delete(message.messageId);
      if (message.command === "conversation.reset" && resetPending) {
        resetPending = false;
        clearConversation();
        setBusy(false);
      }
    } else if (message.type === "command.rejected") {
      if (message.command === "conversation.reset") resetPending = false;
      handleRejected(message);
    } else if (message.type === "protocol.error") {
      notice(`The desk and Claude disagreed about a message (${message.error || "protocol error"}). Try again.`);
    }
  });
  socket.addEventListener("close", () => {
    if (runtimeSocket === socket) runtimeSocket = null;
    // The installed app's runtime is the only backend once it has spoken;
    // keep trying to reach it rather than silently falling back to nothing.
    if (runtimeMode) window.setTimeout(connectRuntime, 2000);
  });
  socket.addEventListener("error", () => {
    socket.close();
  });
}

const source = new EventSource("/events");
source.addEventListener("hello", (event) => {
  const data = JSON.parse(event.data);
  rememberSession({ ...data, restored: Boolean(data.sessionId && (data.transcript || []).length) });
  if (runtimeMode) return;
  // The stream reconnects on its own after a sleep or a hiccup, and the
  // snapshot is the only complete picture: rebuild from it every time.
  state = createDeskState({ permissionMode: state.permissionMode });
  sseSequence = 0;
  sseTurn = 0;
  sseTurnClosed = true;
  replayingTranscript = true;
  try {
    for (const entry of data.transcript || []) {
      if (entry.role === "tool") {
        sseEvent("tool.started", { toolUseId: `replay-${sseSequence + 1}`, name: entry.name, input: entry.input || {} });
        sseEvent("tool.completed", { toolUseId: `replay-${sseSequence}`, name: entry.name });
        continue;
      }
      const type = entry.role === "assistant" ? "assistant.message"
        : entry.role === "user" ? "user.message"
          : entry.role === "notice" ? "desk.notice"
            : "turn.failed";
      sseEvent(type, { text: entry.text || "", detail: entry.detail });
    }
  } finally {
    replayingTranscript = false;
  }
  state = applySnapshot(state, { busy: Boolean(data.busy) });
  sseTurnClosed = !data.busy;
  setBusy(Boolean(data.busy));
  if (data.runtimeError && window.deskApp) {
    notice("The app's connection to Claude Code did not start, so the desk is using a simpler mode: Claude runs each message on its own and does not ask before using tools. Restarting the app usually fixes this.");
    modeEl.textContent = "Autonomous";
    modeEl.dataset.mode = "autonomous";
  }
  paintChat();
  if (statusEl.textContent.startsWith("Reconnecting")) statusEl.textContent = busy ? "Claude is working. Stop cancels this turn." : "Ready";
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
  const { id, name, phase, input } = JSON.parse(event.data);
  sseEvent(phase === "start" ? "tool.started" : "tool.completed", { toolUseId: id || `tool-${name}`, name, input: input || {} });
});
source.addEventListener("notice", (event) => {
  if (!runtimeSocket) notice(JSON.parse(event.data).text);
});
source.addEventListener("question", (event) => {
  if (runtimeSocket) return;
  const { id, questions } = JSON.parse(event.data);
  sseEvent("question.requested", { entityId: id, toolUseId: id, questions: questions || [], readOnly: true });
});
source.addEventListener("thinking", () => {
  if (!runtimeSocket) sseEvent("assistant.thinking", {});
});
source.addEventListener("status", (event) => {
  statusEl.textContent = JSON.parse(event.data).text;
});
source.addEventListener("log", () => {
  // Claude's stderr is kept server-side and shown with the error card if the
  // turn fails; flashing it in the status line only alarmed people.
});
source.addEventListener("turn-error", (event) => {
  if (!event.data || runtimeSocket) return;
  const data = JSON.parse(event.data);
  sseEvent("turn.failed", { text: data.text, detail: data.detail });
  if (/not installed/i.test(data.text || "")) checkClaude();
});
source.addEventListener("autofill-review", (event) => {
  const payload = JSON.parse(event.data);
  sseEvent("autofill.review", payload);
});
source.addEventListener("reset", () => {
  if (runtimeMode) return;
  hasReset = true;
  state = createDeskState({ permissionMode: state.permissionMode });
  sseSequence = 0;
  sseTurn = 0;
  sseTurnClosed = true;
  paintChat();
  jumpBtn.hidden = true;
});
source.addEventListener("idle", () => {
  if (runtimeMode) return;
  closingOld = false;
  // Print mode ends a turn with idle, not turn.completed; a quiet
  // turn.interrupted closes the turn and settles any still-pulsing tool chip.
  if (state.busy) sseEvent("turn.interrupted", {});
  sseTurnClosed = true;
  setBusy(false);
  state = applySnapshot(state, { busy: false });
  paintChat();
  notifyHidden("Claude finished.");
  refreshDeskData();
});
source.onerror = () => {
  // EventSource fires error on every reconnect attempt; only a closed stream
  // means the desk is gone.
  if (source.readyState === EventSource.CLOSED) {
    statusEl.textContent = "The desk stopped. Close this tab and open the desk again.";
  } else {
    statusEl.textContent = "Reconnecting to the desk…";
  }
};

if (openCliBtn) {
  openCliBtn.addEventListener("click", async () => {
    openCliBtn.disabled = true;
    try {
      const res = await fetch("/workspace/cli", { method: "POST" });
      const data = await res.json();
      if (data.error) notice(data.error);
      else statusEl.textContent = "A terminal window opened in your job-search folder. You can keep working here too.";
    } catch {
      notice("Could not open a terminal window on this computer. You can keep working here; nothing is lost.");
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
  if (sent) tabs?.select("chat");
  promptEl.focus();
});

promptEl.addEventListener("input", sizePrompt);
promptEl.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

sheetForm.addEventListener("submit", (event) => {
  if (event.submitter?.value !== "run") return;
  if (!activeCommand) return;
  // Always keep the sheet open until the message is actually sent, so a
  // pasted posting is never thrown away.
  event.preventDefault();
  const values = valuesFromForm(sheetFields);
  const problem = commandInputError(activeCommand, values);
  if (problem) {
    sheetError.textContent = problem;
    sheetError.hidden = false;
    sheetFields.querySelector("input, textarea, select")?.focus();
    return;
  }
  const command = activeCommand;
  runStep(command.id, renderCommandInvocation(command, values)).then((sent) => {
    if (sent) {
      sheet.close();
      return;
    }
    sheetError.textContent = lastSendError || REJECT_TEXT.busy;
    sheetError.hidden = false;
  });
});

stopBtn.addEventListener("click", async () => {
  if (runtimeSend({ type: "turn.interrupt" })) return;
  try {
    const res = await post("/stop");
    if (!res.ok) notice("Could not stop Claude. Try Stop again, or close this tab and open the desk again.");
  } catch {
    notice("Could not stop Claude: the desk is not reachable. Close this tab and open the desk again.");
  }
});
let resetPending = false;
let progressInfo = null;
let toolsInfo = null;
let jobsState = { jobs: [], filter: "open", query: "", status: "loading", error: "", sample: null, samplePosting: "" };
let applicationsState = { applications: [], status: "loading", error: "", preview: null };

async function loadProgress() {
  try {
    const res = await fetch("/progress");
    if (res.ok) progressInfo = await res.json();
  } catch {
    // The checklist is a nicety; the chat works without it.
  }
  if (!state.cards.size) paintChat();
}

async function loadTools({ refresh = false } = {}) {
  try {
    const res = await fetch(refresh ? "/tools?refresh=1" : "/tools");
    if (res.ok) toolsInfo = await res.json();
  } catch {
    toolsInfo = null;
  }
  if (toolsDialog?.open) renderTools(toolsList, toolsInfo);
  if (!state.cards.size) paintChat();
}

function paintJobs() {
  renderJobs(jobsEl, jobsState);
}

async function loadJobs() {
  jobsState = { ...jobsState, status: jobsState.jobs.length ? "ready" : "loading" };
  paintJobs();
  try {
    const res = await fetch("/jobs");
    if (!res.ok) throw new Error("Could not read the job list.");
    const body = await res.json();
    jobsState = {
      ...jobsState,
      jobs: body.jobs || [],
      sample: body.sample || null,
      samplePosting: body.samplePosting || "",
      status: "ready",
      error: "",
    };
  } catch (error) {
    jobsState = { ...jobsState, status: "error", error: error.message };
  }
  paintJobs();
}

function paintApplications() {
  renderApplications(applicationsEl, applicationsState);
}

async function loadApplications() {
  applicationsState = { ...applicationsState, status: applicationsState.applications.length ? "ready" : "loading" };
  paintApplications();
  try {
    const res = await fetch("/applications");
    if (!res.ok) throw new Error("Could not read the tracker.");
    const body = await res.json();
    applicationsState = { ...applicationsState, applications: body.applications || [], status: "ready", error: "" };
  } catch (error) {
    applicationsState = { ...applicationsState, status: "error", error: error.message };
  }
  paintApplications();
}

// After every turn the files may have changed: refresh what the tabs show.
function refreshDeskData() {
  loadProgress();
  if (selectedTab === "jobs") loadJobs();
  if (selectedTab === "applications") loadApplications();
}

// ---- Notifications for long steps that finish while the window is elsewhere
const BASE_TITLE = document.title;
let attentionFlag = false;

function flagAttention() {
  if (!document.hidden) return;
  attentionFlag = true;
  document.title = `● ${BASE_TITLE}`;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && attentionFlag) {
    attentionFlag = false;
    document.title = BASE_TITLE;
  }
});

function notifyHidden(body) {
  flagAttention();
  if (!document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const shown = new Notification("Job Search Desk", { body, tag: "desk-turn", silent: true });
    shown.onclick = () => window.focus();
  } catch {
    // Some browsers refuse without a service worker; the title flag remains.
  }
}

function requestNotificationPermission() {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  try {
    Notification.requestPermission().catch?.(() => {});
  } catch {
    // Not available in this environment.
  }
}
// True between New chat during a running turn and the server's idle.
let closingOld = false;
// Messages sent to the runtime that it has not yet accepted; a rejection puts
// the text back in the composer instead of losing it.
const inFlightSends = new Map();
let lastSendError = "";

function clearConversation() {
  hasReset = true;
  state = createDeskState({ permissionMode: state.permissionMode });
  sseSequence = 0;
  sseTurn = 0;
  sseTurnClosed = true;
  markAction(null);
  paintChat();
  jumpBtn.hidden = true;
  setSessionLabel({ chromeGroup: sessionEl.dataset.chromeGroup, sessionId: null });
}

resetBtn.addEventListener("click", async () => {
  if (!window.confirm("Start a new conversation? The current chat is cleared.")) return;
  if (runtimeSend({ type: "conversation.reset" })) {
    // Old events may still be in flight; the runtime's confirmation is the
    // moment the page can start from zero without adopting a stale cursor.
    resetPending = true;
    statusEl.textContent = "Starting a new conversation…";
    return;
  }
  if (!runtimeSend({ type: "conversation.reset" })) {
    try {
      const res = await post("/reset");
      if (!res.ok) {
        notice("Could not start a new conversation. Try again in a moment.");
        return;
      }
    } catch {
      notice("Could not start a new conversation: the desk is not reachable. Close this tab and open the desk again.");
      return;
    }
  }
  const wasBusy = busy;
  clearConversation();
  if (wasBusy) {
    // The server keeps the old turn busy until Claude has really stopped
    // (idle arrives then); saying Ready now would only earn a rejected send.
    closingOld = true;
    statusEl.textContent = "Closing the old conversation…";
  } else {
    setBusy(false);
  }
});

menuBtn.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));
scrim.addEventListener("click", () => setMenu(false));
jumpBtn.addEventListener("click", jumpToLatest);
logEl.addEventListener("scroll", () => {
  stickToBottom = nearBottom();
  jumpBtn.hidden = stickToBottom || !logEl.querySelector("article");
}, { passive: true });

logEl.addEventListener("submit", (event) => {
  const formNode = event.target.closest("form.interaction");
  if (!formNode) return;
  event.preventDefault();
  const id = formNode.dataset.id;
  const questions = state.cards.get(id)?.payload.questions || [];
  const answers = answersFromQuestionForm(formNode, questions);
  const problem = questionAnswersError(questions, answers);
  const errorEl = formNode.querySelector(".form-error");
  if (problem) {
    if (errorEl) {
      errorEl.textContent = problem;
      errorEl.hidden = false;
    }
    return;
  }
  if (!runtimeSend({ type: "question.response", requestId: id, answers })) {
    notice("Could not send your answer: the desk is not connected to Claude right now.");
    return;
  }
  state = markEntered(state, id);
  paintChat();
});

logEl.addEventListener("click", async (event) => {
  const decision = event.target.closest("[data-decision]");
  if (!decision) return;
  const root = decision.closest("[data-id]");
  const id = root?.dataset.id;
  if (root?.dataset.kind === "autofill") {
    try {
      const res = await post("/autofill/decide", {
        reviewId: id,
        token: root.dataset.token,
        decision: decision.dataset.decision,
        expectedControllerGeneration: state.controllerGeneration,
        conversationId: state.conversationId,
      });
      if (!res.ok) {
        statusEl.textContent = "Could not record that autofill decision.";
        return;
      }
    } catch {
      statusEl.textContent = "Could not record that autofill decision.";
      return;
    }
    state = markEntered(state, id);
    paintChat();
    return;
  }
  if (!runtimeSend({ type: "permission.decision", requestId: id, decision: decision.dataset.decision })) {
    notice("Could not send that decision: the desk is not connected to Claude right now.");
    return;
  }
  state = markEntered(state, id);
  paintChat();
});

function restoreFocusAfterDialog() {
  // The browser restores focus to the opener after this event; look after it.
  window.setTimeout(() => {
    const active = document.activeElement;
    const inHiddenDock = dock.contains(active) && !document.body.classList.contains("menu-open") && menuBtn.offsetParent;
    if (!active || active === document.body || inHiddenDock || (active && !active.isConnected)) {
      (menuBtn.offsetParent ? menuBtn : promptEl).focus();
    }
  }, 0);
}
sheet.addEventListener("close", restoreFocusAfterDialog);
palette.addEventListener("close", restoreFocusAfterDialog);
paletteQuery?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    palette.close();
  }
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
  if (document.body.classList.contains("gated")) return;
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

let terminalSubscriptions = [];
let selectedTab = "chat";

function terminalPlaceholder(host, title, copy) {
  host.innerHTML = `<div class="empty"><p class="kicker">Terminal</p><h2>${title}</h2><p>${copy}</p></div>`;
}

let terminalStarting = null;

function ensureTerminal() {
  if (terminalStarting) return terminalStarting;
  terminalStarting = startTerminal().finally(() => {
    terminalStarting = null;
  });
  return terminalStarting;
}

async function startTerminal() {
  const host = document.getElementById("panel-terminal");
  const bridge = window.deskApp?.terminal;
  if (!host || !bridge) return;
  if (terminalView) {
    terminalView.focus();
    return;
  }
  if (!state.sessionId) {
    terminalPlaceholder(host, "Send one message in Chat first.", "The terminal continues the same conversation, so it needs one to continue.");
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
  const view = terminalView;
  terminalSubscriptions = [
    bridge.onData((payload) => {
      if (payload?.data && terminalView === view) view.write(payload.data);
    }),
    bridge.onExit((payload) => {
      if (terminalView !== view) return;
      view.setInputEnabled(false);
      if (payload?.snapshot) {
        state = applySnapshot(state, payload.snapshot);
        syncBusy();
      }
      releaseTerminal();
      terminalPlaceholder(host, "Claude Code closed.", "Switch to Chat to keep going, or open this tab again to start the terminal.");
    }),
  ].filter((stop) => typeof stop === "function");
  const started = await bridge.start({
    expectedControllerGeneration: state.controllerGeneration,
    cols: 80,
    rows: 24,
  });
  if (!started?.ok) {
    disposeTerminalView();
    terminalPlaceholder(host, "Could not attach Claude.", started?.error === "session-id-required"
      ? "Send one message in Chat first; the terminal continues that conversation."
      : "Stay in Chat; everything works there. Open in Terminal still opens Claude Code in the same folder.");
    return;
  }
  terminalId = started.terminalId;
  if (selectedTab !== "terminal") {
    // The person went back to Chat while the terminal was starting; hand the
    // conversation straight back rather than adopting the terminal controller.
    await releaseTerminal();
    return;
  }
  state = applySnapshot(state, started.snapshot || { controller: "terminal" });
  syncBusy();
  terminalView.focus();
}

function disposeTerminalView() {
  for (const stop of terminalSubscriptions) {
    try { stop(); } catch { /* already gone */ }
  }
  terminalSubscriptions = [];
  terminalView?.dispose();
  terminalView = null;
}

async function releaseTerminal() {
  const host = document.getElementById("panel-terminal");
  const hadView = Boolean(terminalView);
  disposeTerminalView();
  if (hadView && host && !host.querySelector(".empty")) {
    terminalPlaceholder(host, "Claude Code, same conversation.", "Attaching the terminal…");
  }
  if (!terminalId) return;
  const bridge = window.deskApp?.terminal;
  const id = terminalId;
  terminalId = null;
  try {
    const result = await bridge?.dispose({ terminalId: id });
    if (result?.snapshot) {
      state = applySnapshot(state, result.snapshot);
      syncBusy();
    }
  } catch {
    // The handoff back to chat is best-effort; the runtime also resets the
    // persisted controller on load.
  }
}

bindDelegatedActions(document);
document.getElementById("more-steps")?.addEventListener("click", () => {
  setMenu(false);
  openPalette();
});
const surfaceTabs = [{ id: "chat", label: "Chat" }, { id: "jobs", label: "Jobs" }, { id: "applications", label: "Applications" }];
if (window.deskApp?.terminal) surfaceTabs.push({ id: "terminal", label: "Terminal" });
surfaceTabs.push({ id: "files", label: "Files" });
const tabs = mountTabs(document.getElementById("surface-tabs"), {
  tabs: surfaceTabs,
  selectedId: "chat",
  onSelect(id) {
    selectedTab = id;
    if (id === "files") loadArtifacts();
    if (id === "jobs") loadJobs();
    if (id === "applications") loadApplications();
    if (id === "terminal") ensureTerminal();
    if (id !== "terminal") releaseTerminal();
    // A reply that finished while another tab was in front left the log
    // scrolled mid-way with no Latest button.
    if (id === "chat") requestAnimationFrame(scrollLog);
  },
});
function applyPracticeJob() {
  if (!jobsState.samplePosting) return;
  runStep("apply", `/apply\n\n${jobsState.samplePosting}`);
}

jobsEl.addEventListener("click", async (event) => {
  const filter = event.target.closest("[data-job-filter]");
  if (filter) {
    jobsState = { ...jobsState, filter: filter.dataset.jobFilter };
    paintJobs();
    return;
  }
  if (event.target.closest("[data-sample-job]")) {
    applyPracticeJob();
    return;
  }
  const action = event.target.closest("[data-job-action]");
  if (!action) return;
  const row = action.closest("[data-job-key]");
  const job = jobsState.jobs.find((item) => item.key === row?.dataset.jobKey)
    || (jobsState.sample?.key === row?.dataset.jobKey ? jobsState.sample : null);
  if (!job) return;
  const kind = action.dataset.jobAction;
  if (kind === "apply") {
    if (job.sample) {
      applyPracticeJob();
      return;
    }
    if (job.url) runStep("apply", `/apply ${job.url}`);
    else runStep("apply", `/apply\n${[job.title, job.company].filter(Boolean).join(" at ")} (no link was saved; ask me for the posting if you need it)`);
    return;
  }
  if (kind === "autofill") {
    runStep("autofill", `/autofill ${job.url}`);
    return;
  }
  const mark = kind === "interested" ? "interested" : kind === "ignore" ? "ignored" : null;
  action.disabled = true;
  try {
    const res = await post("/jobs/mark", { key: job.key, mark });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not save that.");
    jobsState = { ...jobsState, jobs: body.jobs || jobsState.jobs };
  } catch (error) {
    notice(error.message || "Could not save that.");
  }
  paintJobs();
});
jobsEl.addEventListener("input", (event) => {
  const search = event.target.closest("[data-job-search]");
  if (!search) return;
  jobsState = { ...jobsState, query: search.value };
  const list = jobsEl.querySelector(".job-list");
  if (list) {
    // Repaint only the rows so the search box keeps focus and its caret.
    const fresh = jobsEl.ownerDocument.createElement("section");
    renderJobs(fresh, jobsState);
    const next = fresh.querySelector(".job-list");
    if (next) list.replaceWith(next);
  }
});

applicationsEl.addEventListener("click", async (event) => {
  const file = event.target.closest("[data-file]");
  if (file) {
    await previewWorkspaceFile(file.dataset.file);
    return;
  }
  const reveal = event.target.closest("[data-reveal]");
  if (reveal) {
    if (!window.confirm("Show this application's folder on your computer?")) return;
    post("/workspace-file/open", { path: `${reveal.dataset.reveal}/job_posting.md`, reveal: true }).catch(() => {});
    return;
  }
  const open = event.target.closest("[data-open-file]");
  if (open) {
    if (!window.confirm("Open this file in its usual app (for example Word or your PDF viewer)?")) return;
    post("/workspace-file/open", { path: open.dataset.openFile }).catch(() => notice("Could not open that file."));
    return;
  }
  if (event.target.closest("[data-close-preview]")) {
    applicationsState = { ...applicationsState, preview: null };
    paintApplications();
    return;
  }
  const action = event.target.closest("[data-app-action]");
  if (!action) return;
  const row = action.closest("[data-app-id]");
  const target = [row?.dataset.company, row?.dataset.role].filter(Boolean).join(" ");
  if (action.dataset.appAction === "outcome") runStep("outcome", `/outcome ${target}`.trim());
  if (action.dataset.appAction === "interview") runStep("interview", `/interview ${row?.dataset.company || ""}`.trim());
});

async function previewWorkspaceFile(path) {
  const src = `/workspace-file?path=${encodeURIComponent(path)}`;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(res.status === 415 ? "This file type has no preview; use Open instead." : "That file is not in your job-search folder any more.");
    const type = res.headers.get("content-type") || "";
    applicationsState = {
      ...applicationsState,
      preview: type.includes("pdf") ? { path, kind: "pdf", src } : { path, kind: "text", text: await res.text() },
    };
  } catch (error) {
    notice(error.message);
    return;
  }
  paintApplications();
  applicationsEl.querySelector(".file-preview")?.scrollIntoView({ block: "start" });
}

// Checklist and dock buttons.
document.addEventListener("click", (event) => {
  const step = event.target.closest("[data-checklist-action]");
  if (step) {
    const action = step.dataset.checklistAction;
    if (action === "documents") docInput.click();
    else if (action === "apply") tabs?.select("jobs");
    else runAction(action);
    return;
  }
  if (event.target.closest("[data-open-tools]") || event.target.closest("#open-tools")) {
    openTools();
  }
});
document.getElementById("add-documents")?.addEventListener("click", () => docInput.click());
document.getElementById("tools-refresh")?.addEventListener("click", () => {
  toolsList.innerHTML = "<p>Checking…</p>";
  loadTools({ refresh: true });
});

function openTools() {
  renderTools(toolsList, toolsInfo);
  toolsDialog.showModal();
  if (!toolsInfo) loadTools();
}

// ---- Documents: a file picker and a drop zone, both saved into documents/.
async function uploadDocuments(files) {
  const list = [...(files || [])];
  if (!list.length) return;
  const saved = [];
  for (const file of list) {
    try {
      const kind = /linkedin/i.test(file.name) ? "linkedin" : "cv";
      const res = await fetch(`/documents?name=${encodeURIComponent(file.name)}&kind=${kind}`, { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The upload did not finish.");
      saved.push(body.relativePath);
      if (body.progress) progressInfo = body.progress;
    } catch (error) {
      notice(`${file.name}: ${error.message}`);
    }
  }
  if (!saved.length) return;
  notice(`Added ${saved.length === 1 ? saved[0] : `${saved.length} files`} to your documents folder. Run Setup and Claude reads ${saved.length === 1 ? "it" : "them"}.`);
  if (!state.cards.size) paintChat();
}

docInput?.addEventListener("change", () => {
  uploadDocuments(docInput.files);
  docInput.value = "";
});

let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  dragDepth += 1;
  dropzone.hidden = false;
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropzone.hidden = true;
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  dragDepth = 0;
  dropzone.hidden = true;
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  uploadDocuments(event.dataTransfer.files);
});

// ---- How much Claude asks (installed app only; print mode has one mode).
modeToggle?.addEventListener("click", () => modeSheet.showModal());
modeSheet?.addEventListener("click", (event) => {
  const choice = event.target.closest("[data-mode-choice]");
  if (!choice) return;
  modeSheet.close();
  const mode = choice.dataset.modeChoice;
  if (mode === state.permissionMode) return;
  if (!runtimeSend({ type: "permission.mode", mode })) notice("The desk is not connected to Claude right now; try again in a moment.");
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
    filesEl.querySelector(`[data-artifact-id="${CSS.escape(artifactState.selectedId || "")}"]`)?.focus();
  }
});
paintChat();
paintFiles();
loadProgress();
loadTools();

fetch("/commands")
  .then((res) => res.json())
  .then((data) => {
    commands = data.commands || [];
    if (commands.length) renderSidebar(stepsEl, commands);
  })
  .catch(() => {});

connectRuntime();

const gate = document.getElementById("gate");
const gateDock = document.getElementById("dock");
const gateStage = document.querySelector("main.stage");
const gateTitle = document.getElementById("gate-title");
const gateCopy = document.getElementById("gate-copy");
const gateLog = document.getElementById("gate-log");
const gateAction = document.getElementById("gate-action");
const gateCancel = document.getElementById("gate-cancel");
const gateCodeWrap = document.getElementById("gate-code-wrap");
const gateCode = document.getElementById("gate-code");
const gateChrome = document.getElementById("gate-chrome");
const gateLink = document.getElementById("gate-link");
const gateLinkWrap = document.getElementById("gate-link-wrap");
const accountLabel = document.getElementById("account-label");

let authWaiter = null;
let lastHealth = null;
let claudeAutoStarted = false;

function setGate(open, title, copy) {
  document.body.classList.toggle("gated", open);
  gate.hidden = !open;
  gate.inert = !open;
  gate.setAttribute("aria-hidden", String(!open));
  for (const node of [gateDock, gateStage]) {
    if (!node) continue;
    node.inert = open;
    node.setAttribute("aria-hidden", String(open));
  }
  if (title) gateTitle.textContent = title;
  if (copy) gateCopy.textContent = copy;
  if (open) {
    setMenu(false);
    gate.querySelector(".gate-card")?.focus();
  } else {
    promptEl.focus();
  }
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
  gateLinkWrap.hidden = true;
  if (health.loggedIn) {
    setGate(false);
    return true;
  }
  if (needsInstall(health)) {
    setGate(true, "Starting Claude Code", "The desk installs Claude Code if it is missing, then opens a claude.ai sign-in page. Sign in with the same email you use for your Claude subscription (Pro, Max, Team, or Enterprise). Nothing else to set up.");
    gateAction.textContent = claudeAutoStarted ? "Working…" : "Install and sign in";
    return false;
  }
  if (needsLogin(health)) {
    setGate(true, "Starting Claude Code", "A claude.ai sign-in page will open in your browser. Sign in with the same email you use for your Claude subscription (Pro, Max, Team, or Enterprise). Nothing else to set up.");
    gateAction.textContent = claudeAutoStarted ? "Working…" : "Sign in with Claude";
    return false;
  }
  setGate(false);
  return true;
}

function autoStartClaude(health) {
  if (claudeAutoStarted) return;
  if (!needsInstall(health) && !needsLogin(health)) return;
  claudeAutoStarted = true;
  bootstrapClaude();
}

async function bootstrapClaude() {
  gateAction.disabled = true;
  gateAction.textContent = "Working…";
  gateCancel.hidden = false;
  try {
    let health = await readHealth();
    if (needsInstall(health)) {
      appendGateLog("Installing Claude Code with the official installer. This can take a minute or two.");
      if (window.deskApp?.ensureClaude) {
        // The app runs this install itself; there is nothing to cancel here.
        gateCancel.hidden = true;
        let info = await window.deskApp.ensureClaude();
        let ticks = 0;
        while (info?.status === "installing") {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          info = await window.deskApp.ensureClaude();
          ticks += 1;
          if (ticks % 10 === 0) appendGateLog("Still installing…");
        }
        if (info?.status === "failed") throw new Error(info.error || "Claude Code did not install.");
        health = info?.health || (await readHealth());
      } else {
        const res = await post("/auth/install");
        if (!res.ok) throw new Error("Install is already running.");
        const done = await waitForAuth("install");
        if (!done.ok) throw new Error(done.error || "Claude Code did not install.");
        health = done.health || (await readHealth());
      }
    }
    if (needsLogin(health)) {
      appendGateLog("Opening the claude.ai sign-in. Finish it in the browser, then return here.");
      const res = await post("/auth/login");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (!body.running) throw new Error("The sign-in could not start. Try again.");
        // A reloaded page joins the sign-in already in progress.
        appendGateLog("A sign-in is already in progress in your browser.");
        if (body.urls?.[0]) showSignInLink(body.urls[0]);
        if (body.needsCode) {
          gateCodeWrap.hidden = false;
        }
      }
      const done = await waitForAuth("login");
      if (done.kind === "cancel") {
        gateTitle.textContent = "Sign-in cancelled";
        gateCopy.textContent = "No problem. Click Sign in with Claude when you are ready.";
        gateAction.textContent = "Sign in with Claude";
        claudeAutoStarted = false;
        return;
      }
      if (!done.ok) throw new Error(done.error || "The sign-in did not finish. Try again, and use the link above if no tab opened.");
      health = done.health || (await readHealth());
    }
    if (health.loggedIn || (!needsLogin(health) && !needsInstall(health))) {
      applyHealth(health);
      return;
    }
    throw new Error("Claude Code is installed but still signed out. Click Sign in with Claude to try again.");
  } catch (err) {
    appendGateLog(err.message);
    gateTitle.textContent = "Could not connect";
    gateCopy.textContent = err.message;
    gateAction.textContent = "Try again";
    claudeAutoStarted = false;
  } finally {
    gateAction.disabled = false;
    gateCancel.hidden = true;
  }
}

function showSignInLink(url) {
  if (!/^https:\/\//.test(url)) return;
  gateLink.href = url;
  gateLinkWrap.hidden = false;
}

source.addEventListener("auth-log", (event) => appendGateLog(JSON.parse(event.data).text));
source.addEventListener("auth-url", (event) => {
  // Claude Code opens the browser itself and prints the same URL as a
  // fallback. Opening it again here is what produced two sign-in tabs.
  const data = JSON.parse(event.data);
  if (data.kind !== "login") return;
  showSignInLink(data.url);
  gateCopy.textContent = "A claude.ai sign-in tab opened in your browser. Finish signing in there, then come back to this window. If claude.ai shows you a code, paste it below.";
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

gateAction.addEventListener("click", () => {
  if (!lastHealth) {
    checkClaude();
    return;
  }
  bootstrapClaude();
});
gateCancel.addEventListener("click", () => post("/auth/cancel"));
gateCode.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
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

function checkClaude() {
  return readHealth()
    .then((health) => {
      applyHealth(health);
      autoStartClaude(health);
    })
    .catch(() => {
      lastHealth = null;
      accountLabel.textContent = "Claude status unknown";
      setGate(true, "Could not check Claude Code", "The desk could not find out whether Claude Code is installed and signed in. Try again in a moment.");
      gateAction.textContent = "Try again";
      gateAction.disabled = false;
    });
}

const updateBtn = document.getElementById("update-btn");

async function refreshUpdate() {
  if (!updateBtn) return;
  try {
    const res = await fetch("/update/status");
    if (!res.ok) return;
    const info = await res.json();
    if (info.channel === "downloaded" && info.version) {
      updateBtn.hidden = false;
      updateBtn.textContent = `Restart for ${info.version}`;
    } else if (info.channel === "manual") {
      updateBtn.hidden = false;
      updateBtn.textContent = "Get latest Desk";
    } else {
      updateBtn.hidden = true;
    }
    updateBtn.dataset.channel = info.channel || "";
    updateBtn.dataset.releases = info.releasesUrl || "";
  } catch {
    // Leave the last known button state if the endpoint blips.
  }
}

updateBtn?.addEventListener("click", async () => {
  if (updateBtn.dataset.channel === "manual") {
    const href = updateBtn.dataset.releases;
    if (href) window.open(href, "_blank", "noreferrer");
    return;
  }
  try {
    const res = await post("/update/install");
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) {
      notice(data?.error || "Could not restart into the new version.");
    }
  } catch {
    notice("Could not reach the local desk.");
  }
});

checkClaude();

tickClock();
window.setInterval(tickClock, 30000);
refreshUpdate();
window.setInterval(refreshUpdate, 60_000);
sizePrompt();
promptEl.focus();
