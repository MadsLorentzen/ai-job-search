const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const sessionEl = document.getElementById("session-label");
const workspaceEl = document.getElementById("workspace-label");
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
const focusWrap = document.getElementById("focus-wrap");
const urlWrap = document.getElementById("url-wrap");
const pasteWrap = document.getElementById("paste-wrap");
const focusEl = document.getElementById("focus");
const urlEl = document.getElementById("job-url");
const textEl = document.getElementById("job-text");
const clockEl = document.getElementById("clock");
const menuBtn = document.getElementById("menu");
const scrim = document.getElementById("scrim");
const jumpBtn = document.getElementById("jump");

let busy = false;
let assistant = null;
let sheetKind = null;
let renderTimer = 0;
let stickToBottom = true;

const ACTIONS = {
  setup: { prompt: "/setup" },
  rank: { prompt: "/rank" },
  interview: { prompt: "/interview" },
  outcome: { prompt: "/outcome" },
  scrape: { sheet: "scrape" },
  apply: { sheet: "apply" },
  autofill: { sheet: "autofill" },
};

function emptyMarkup(kind) {
  if (kind === "reset") {
    return `<div class="empty" id="empty">
      <p class="kicker">Clean slate</p>
      <h2>New conversation.</h2>
      <p>The page is clear. The Job Search Desk Chrome group stays, so Autofill and browser work keep landing in the same place.</p>
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

function hideEmpty() {
  document.getElementById("empty")?.remove();
}

function bindEmptyActions(root = document) {
  root.querySelectorAll("[data-action]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => runAction(button.dataset.action));
  });
  root.querySelectorAll("[data-prompt]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => sendPrompt(button.dataset.prompt));
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

function setBusy(next) {
  busy = next;
  sendBtn.disabled = next;
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

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function markdown(text) {
  if (window.marked && window.DOMPurify) {
    return window.DOMPurify.sanitize(window.marked.parse(text || "", { gfm: true, breaks: true }));
  }
  // Never hand unsanitized model output to innerHTML.
  return escapeHtml(text || "").replace(/\n/g, "<br>");
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function tickClock() {
  const now = new Date();
  clockEl.dateTime = now.toISOString();
  clockEl.textContent = formatTime(now);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = "Copy";
    }, 1200);
  } catch {
    button.textContent = "Copy failed";
  }
}

function addMessage(role, text = "") {
  hideEmpty();
  const article = document.createElement("article");
  article.className = `msg ${role}`;
  const head = document.createElement("div");
  head.className = "msg-head";
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = role === "user" ? "You" : role === "error" ? "Stopped" : "Claude";
  const time = document.createElement("time");
  time.className = "msg-time";
  time.dateTime = new Date().toISOString();
  time.textContent = formatTime();
  const tools = document.createElement("div");
  tools.className = "tools";
  const body = document.createElement("div");
  body.className = "body";
  if (role === "assistant") {
    body.dataset.raw = text;
    body.innerHTML = markdown(text);
  } else {
    body.textContent = text;
  }
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "msg-copy";
  copy.textContent = "Copy";
  copy.addEventListener("click", () => {
    const raw = role === "assistant" ? body.dataset.raw || "" : body.textContent || "";
    copyText(raw, copy);
  });
  head.append(who, time, copy);
  article.append(head, tools, body);
  logEl.append(article);
  stickToBottom = true;
  scrollLog();
  return { article, tools, body };
}

function ensureAssistant() {
  if (!assistant) assistant = addMessage("assistant", "");
  return assistant;
}

function paintAssistant() {
  if (!assistant) return;
  assistant.body.innerHTML = markdown(assistant.body.dataset.raw || "");
  scrollLog();
}

function appendDelta(text) {
  const node = ensureAssistant();
  node.body.dataset.raw = (node.body.dataset.raw || "") + text;
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(paintAssistant, 80);
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  return res;
}

async function sendPrompt(prompt) {
  const text = prompt.trim();
  if (!text || busy) return;
  if (!lastHealth?.loggedIn) {
    // Only pay for a health check while signed out; a check spawns Claude Code.
    try {
      lastHealth = await readHealth();
    } catch {
      // Keep the last known status if the health endpoint blips.
    }
  }
  if (needsInstall(lastHealth) || needsLogin(lastHealth) || !lastHealth?.installed) {
    applyHealth(lastHealth || { installed: false });
    if (!lastHealth?.installed && !needsInstall(lastHealth) && !needsLogin(lastHealth)) {
      addMessage("error", "Claude Code is not installed yet. Use the Connect Claude button.");
    }
    return;
  }
  assistant = null;
  setMenu(false);
  setBusy(true);
  try {
    const res = await post("/send", { prompt: text });
    if (!res.ok) throw new Error();
  } catch {
    setBusy(false);
    addMessage("error", "The desk could not reach the local server. Is the terminal still running?");
  }
}

function runAction(name) {
  const spec = ACTIONS[name];
  if (!spec) return;
  markAction(name);
  setMenu(false);
  if (spec.prompt) {
    sendPrompt(spec.prompt);
    return;
  }
  openSheet(spec.sheet);
}

function openSheet(kind) {
  sheetKind = kind;
  focusWrap.hidden = kind !== "scrape";
  urlWrap.hidden = kind === "scrape";
  pasteWrap.hidden = kind !== "apply";
  if (kind === "scrape") {
    sheetKicker.textContent = "02  Scrape";
    sheetTitle.textContent = "Find openings";
    sheetCopy.textContent = "Leave focus blank for the usual US search. Add a lane if you want it narrowed.";
  } else if (kind === "apply") {
    sheetKicker.textContent = "04  Apply";
    sheetTitle.textContent = "Draft the packet";
    sheetCopy.textContent = "A Greenhouse, Lever, Ashby, or careers URL is best. If the board blocks fetching, paste the posting.";
  } else {
    sheetKicker.textContent = "05  Autofill";
    sheetTitle.textContent = "Fill the form";
    sheetCopy.textContent = "This prefills the form and leaves Submit to you. Use the employer ATS link, not LinkedIn.";
  }
  sheet.showModal();
  (kind === "scrape" ? focusEl : urlEl).focus();
}

function promptFromSheet() {
  if (sheetKind === "scrape") {
    const focus = focusEl.value.trim();
    return focus ? `/scrape ${focus}` : "/scrape";
  }
  const url = urlEl.value.trim();
  const pasted = textEl.value.trim();
  if (sheetKind === "autofill") {
    return url ? `/autofill ${url}` : "";
  }
  if (url) return `/apply ${url}`;
  if (pasted) return `/apply\n\n${pasted}`;
  return "";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = promptEl.value;
  promptEl.value = "";
  sizePrompt();
  sendPrompt(value);
  promptEl.focus();
});

promptEl.addEventListener("input", sizePrompt);

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

bindEmptyActions();

sheetForm.addEventListener("submit", (event) => {
  if (event.submitter?.value !== "run") return;
  const prompt = promptFromSheet();
  if (!prompt) {
    event.preventDefault();
    statusEl.textContent = sheetKind === "scrape" ? "Add a focus or run it empty." : "Add a URL or paste the posting.";
    return;
  }
  sendPrompt(prompt);
});

stopBtn.addEventListener("click", () => post("/stop"));
resetBtn.addEventListener("click", async () => {
  await post("/reset");
  assistant = null;
  logEl.querySelectorAll("article").forEach((node) => node.remove());
  if (!document.getElementById("empty")) {
    logEl.insertAdjacentHTML("afterbegin", emptyMarkup("reset"));
    bindEmptyActions(logEl);
  }
  stickToBottom = true;
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
    promptEl.focus();
  }
});

function rememberSession(data) {
  if (data.chromeGroup) sessionEl.dataset.chromeGroup = data.chromeGroup;
  if (data.sessionId) sessionEl.dataset.sessionId = data.sessionId;
  else delete sessionEl.dataset.sessionId;
  setSessionLabel(data);
}

const source = new EventSource("/events");
source.addEventListener("hello", (event) => {
  const data = JSON.parse(event.data);
  setBusy(Boolean(data.busy));
  rememberSession(data);
});

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
source.addEventListener("session", (event) => {
  rememberSession(JSON.parse(event.data));
});
source.addEventListener("user", (event) => {
  addMessage("user", JSON.parse(event.data).text);
});
source.addEventListener("delta", (event) => {
  appendDelta(JSON.parse(event.data).text);
});
source.addEventListener("result", (event) => {
  const text = JSON.parse(event.data).text;
  const node = ensureAssistant();
  if (!(node.body.dataset.raw || "").trim()) {
    node.body.dataset.raw = text;
    paintAssistant();
  }
});
source.addEventListener("tool", (event) => {
  const { name, phase } = JSON.parse(event.data);
  const node = ensureAssistant();
  const chip = document.createElement("span");
  chip.className = phase === "start" ? "tool live" : "tool";
  chip.textContent = phase === "start" ? name : `${name} done`;
  node.tools.append(chip);
});
source.addEventListener("status", (event) => {
  statusEl.textContent = JSON.parse(event.data).text;
});
source.addEventListener("log", (event) => {
  statusEl.textContent = JSON.parse(event.data).text.slice(0, 180);
});
source.addEventListener("error", (event) => {
  if (event.data) addMessage("error", JSON.parse(event.data).text);
});
source.addEventListener("reset", () => {
  // Stay busy until the server's idle event: the old turn may still be closing.
});
source.addEventListener("idle", () => {
  window.clearTimeout(renderTimer);
  paintAssistant();
  assistant = null;
  setBusy(false);
});
source.onerror = () => {
  statusEl.textContent = "Lost the local server. Run node gui/server.mjs again.";
};

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

source.addEventListener("auth-log", (event) => {
  appendGateLog(JSON.parse(event.data).text);
});
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
