const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const sessionEl = document.getElementById("session-label");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const resetBtn = document.getElementById("reset");
const form = document.getElementById("compose");
const sheet = document.getElementById("sheet");
const sheetForm = document.getElementById("sheet-form");
const sheetTitle = document.getElementById("sheet-title");
const sheetCopy = document.getElementById("sheet-copy");
const focusWrap = document.getElementById("focus-wrap");
const pasteWrap = document.getElementById("paste-wrap");
const focusEl = document.getElementById("focus");
const urlEl = document.getElementById("job-url");
const textEl = document.getElementById("job-text");

let busy = false;
let assistant = null;
let sheetKind = null;
let renderTimer = 0;

const ACTIONS = {
  setup: { prompt: "/setup" },
  rank: { prompt: "/rank" },
  interview: { prompt: "/interview" },
  outcome: { prompt: "/outcome" },
  scrape: { sheet: "scrape" },
  apply: { sheet: "apply" },
  autofill: { sheet: "autofill" },
};

function hideEmpty() {
  document.getElementById("empty")?.remove();
}

function setBusy(next) {
  busy = next;
  sendBtn.disabled = next;
  stopBtn.hidden = !next;
  statusEl.textContent = next ? "Claude is working" : "Ready";
}

function markdown(text) {
  const raw = window.marked?.parse(text || "", { gfm: true, breaks: true }) || text;
  return window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
}

function addMessage(role, text = "") {
  hideEmpty();
  const article = document.createElement("article");
  article.className = `msg ${role}`;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = role === "user" ? "You" : role === "error" ? "Stopped" : "Claude";
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
  article.append(who, tools, body);
  logEl.append(article);
  logEl.scrollTop = logEl.scrollHeight;
  return { article, tools, body };
}

function ensureAssistant() {
  if (!assistant) assistant = addMessage("assistant", "");
  return assistant;
}

function paintAssistant() {
  if (!assistant) return;
  assistant.body.innerHTML = markdown(assistant.body.dataset.raw || "");
  logEl.scrollTop = logEl.scrollHeight;
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
  assistant = null;
  setBusy(true);
  const res = await post("/send", { prompt: text });
  if (!res.ok) {
    setBusy(false);
    addMessage("error", "The desk could not reach the local server. Is the terminal still running?");
  }
}

function runAction(name) {
  const spec = ACTIONS[name];
  if (!spec) return;
  if (spec.prompt) {
    sendPrompt(spec.prompt);
    return;
  }
  openSheet(spec.sheet);
}

function openSheet(kind) {
  sheetKind = kind;
  focusWrap.hidden = kind !== "scrape";
  pasteWrap.hidden = kind === "autofill";
  if (kind === "scrape") {
    sheetTitle.textContent = "Scrape";
    sheetCopy.textContent = "Leave focus blank for the usual US search. Add a lane if you want it narrowed.";
  } else if (kind === "apply") {
    sheetTitle.textContent = "Apply";
    sheetCopy.textContent = "A Greenhouse, Lever, Ashby, or careers URL is best. If the board blocks fetching, paste the posting.";
  } else {
    sheetTitle.textContent = "Autofill";
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
  sendPrompt(value);
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => runAction(button.dataset.action));
});

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
    logEl.insertAdjacentHTML(
      "afterbegin",
      `<div class="empty" id="empty"><h2>New conversation.</h2><p>Previous turns stay in Claude's session history on disk. This view is clean so you can start the next task without the old scroll.</p></div>`,
    );
  }
  sessionEl.textContent = "New session";
});

const source = new EventSource("/events");
source.addEventListener("hello", (event) => {
  const data = JSON.parse(event.data);
  setBusy(Boolean(data.busy));
  if (data.sessionId) sessionEl.textContent = `Session ${data.sessionId.slice(0, 8)}`;
});
source.addEventListener("session", (event) => {
  const id = JSON.parse(event.data).sessionId || "";
  sessionEl.textContent = id ? `Session ${id.slice(0, 8)}` : "New session";
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
  setBusy(false);
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

function setGate(open, title, copy) {
  document.body.classList.toggle("gated", open);
  gate.hidden = !open;
  if (title) gateTitle.textContent = title;
  if (copy) gateCopy.textContent = copy;
}

function appendGateLog(text) {
  gateLog.hidden = false;
  gateLog.textContent = `${gateLog.textContent}${gateLog.textContent ? "\n" : ""}${text}`.slice(-2000);
  gateLog.scrollTop = gateLog.scrollHeight;
}

function describeAccount(health) {
  if (!health?.loggedIn) return "localhost only · skip-permissions";
  const plan = health.subscriptionType ? ` · ${health.subscriptionType}` : "";
  return health.email ? `${health.email}${plan}` : `Signed in${plan}`;
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
  accountLabel.textContent = describeAccount(health);
  if (health.installed && health.loggedIn) {
    setGate(false);
    gateCancel.hidden = true;
    gateCodeWrap.hidden = true;
    return true;
  }
  if (!health.installed) {
    setGate(true, "Install Claude Code", "The desk uses Claude Code on this machine. One click runs Anthropic's official installer, then signs you in with the same Claude account you use in Chrome.");
    gateAction.textContent = "Install and sign in";
  } else {
    setGate(true, "Sign in with Claude", "A browser window will open on claude.ai. Use the same email as your Chrome Claude subscription (Pro, Max, Team, or Enterprise). API keys are not required.");
    gateAction.textContent = "Sign in with Claude";
  }
  return false;
}

async function bootstrapClaude() {
  gateAction.disabled = true;
  gateCancel.hidden = false;
  try {
    let health = await readHealth();
    if (!health.installed) {
      appendGateLog("Installing Claude Code with the official installer.");
      const res = await post("/auth/install");
      if (!res.ok) throw new Error("Install is already running.");
      const done = await waitForAuth("install");
      if (!done.ok) throw new Error(done.error || "Claude Code did not install.");
      health = done.health || (await readHealth());
    }
    if (!health.loggedIn) {
      appendGateLog("Opening the claude.ai login. Finish it in the browser, then return here.");
      const res = await post("/auth/login");
      if (!res.ok) throw new Error("Login is already running.");
      const done = await waitForAuth("login");
      if (!done.ok) throw new Error(done.error || "Claude login did not finish.");
      health = done.health || (await readHealth());
    }
    if (!applyHealth(health)) {
      throw new Error("Claude is installed but still signed out. Try Sign in again.");
    }
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
    setGate(true, "Desk is starting", "Waiting for the local server. If this stays here, start the app again.");
    gateAction.textContent = "Try again";
  });
