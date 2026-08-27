#!/usr/bin/env node
/**
 * Local desk for this repo. Claude Code does the work in print mode
 * with --dangerously-skip-permissions. This process only binds 127.0.0.1.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildClaudeArgs,
  chromeEnabled,
  clearDeskSession,
  commandLooksInstalled,
  exitErrorText,
  extractHttpsUrls,
  getClaudeHealth,
  loadDeskSession,
  loginNeedsCode,
  loginSucceeded,
  MISSING_CLAUDE_TEXT,
  resolveCommand,
  saveDeskSession,
  shouldRetryWithoutResume,
  spawnClaude,
  spawnOfficialInstall,
  spawnSubscriptionLogin,
} from "./claude.mjs";
import { CHROME_EXTENSION_URL, CLAUDE_AI_URL, CLAUDE_PRICING_URL, DESK_SESSION_NAME } from "./defaults.mjs";
import { existingWorkspaceHint, rememberWorkspace, resolveWorkspace, startCli } from "./workspace.mjs";

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const HOST = "127.0.0.1";
const PORT = Number(process.env.JOB_SEARCH_GUI_PORT || 8765);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const clients = new Set();
let workspace = join(HERE, "..");
let busy = false;
let sessionId = null;
let child = null;
let helper = null;
let streamedText = false;
let sawInit = false;
let stopRequested = false;
// Turn generations: a child spawned before the latest /reset must not write
// state or stream into the fresh conversation. Without this, "New chat"
// during a busy turn lets the dying child's buffered stdout re-save the old
// session id, and the next /send resumes the conversation the user reset.
let turnGen = 0;
let resetGen = 0;
// Rendered conversation, replayed to a client that reconnects (page refresh).
const transcript = [];
let turnText = "";
// tool_use id -> tool name, so "done" chips can show the name, not the id.
const toolNames = new Map();

function send(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

function snapshot(withTranscript = false) {
  const base = {
    sessionId,
    busy,
    chromeGroup: chromeEnabled() ? DESK_SESSION_NAME : null,
    workspace,
  };
  if (withTranscript) base.transcript = transcript.slice(-200);
  return base;
}

function extractText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function emitTools(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type === "tool_use" && block.name) {
      if (block.id) toolNames.set(block.id, block.name);
      send("tool", { name: block.name, phase: "start" });
    }
    if (block?.type === "tool_result") {
      send("tool", { name: toolNames.get(block.tool_use_id) || "tool", phase: "done" });
    }
  }
}

function handleStreamLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (typeof event.session_id === "string" && event.session_id !== sessionId) {
    sessionId = event.session_id;
    saveDeskSession(workspace, sessionId);
    send("session", { sessionId, chromeGroup: snapshot().chromeGroup });
  }

  if (event.type === "system" && event.subtype === "init") {
    sawInit = true;
    send("status", { text: "Claude is in the repo" });
    return;
  }

  if (event.type === "assistant") {
    emitTools(event.message);
    const text = extractText(event.message);
    if (text && !streamedText) {
      turnText += text;
      send("delta", { text });
    }
    return;
  }

  if (event.type === "user") {
    emitTools(event.message);
    return;
  }

  if (event.type === "stream_event") {
    const inner = event.event || {};
    if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
      const block = inner.content_block;
      if (block.id && block.name) toolNames.set(block.id, block.name);
      send("tool", { name: block.name || "tool", phase: "start" });
    }
    const delta = inner.delta;
    if (delta?.type === "text_delta" && delta.text) {
      streamedText = true;
      turnText += delta.text;
      send("delta", { text: delta.text });
    }
    return;
  }

  if (event.type === "result") {
    if (typeof event.result === "string" && event.result && !streamedText) {
      if (!turnText.trim()) turnText = event.result;
      send("result", { text: event.result });
    }
    if (event.is_error) {
      send("turn-error", { text: event.result || "Claude reported an error." });
    }
  }
}

function stopProcess(proc, group) {
  if (!proc) return;
  const pid = proc.pid;
  if (IS_WIN && pid) {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    killer.on("error", () => {
      try {
        proc.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    });
    return;
  }
  if (pid && group) {
    try {
      process.kill(-pid, "SIGTERM");
      return;
    } catch {
      // Fall through to a direct kill.
    }
  }
  proc.kill("SIGTERM");
}

function stopClaude(reason = "Stopped") {
  if (!child) return;
  stopRequested = true;
  stopProcess(child, !IS_WIN);
  send("status", { text: reason });
}

function stopHelper() {
  if (!helper) return;
  stopProcess(helper, false);
  helper = null;
}

function attachHelperOutput(proc, kind) {
  const onChunk = (chunk) => {
    const text = chunk.toString("utf8");
    if (!text.trim()) return;
    send("auth-log", { kind, text: text.trim() });
    for (const url of extractHttpsUrls(text)) {
      send("auth-url", { kind, url });
    }
    if (kind === "login" && loginNeedsCode(text)) {
      send("auth-code", { needed: true });
    }
    if (kind === "login" && loginSucceeded(text)) {
      try {
        proc.stdin?.write("\n");
      } catch {
        // Login may already have closed stdin.
      }
    }
  };
  proc.stdout?.on("data", onChunk);
  proc.stderr?.on("data", onChunk);
}

function runHelper(kind, factory) {
  if (helper) {
    send("auth-log", { kind, text: "Already running a setup step. Wait or cancel." });
    return false;
  }
  const proc = factory();
  helper = proc;
  // A write to a stdin the helper already closed must not crash the desk.
  proc.stdin?.on("error", () => {});
  send("auth-log", { kind, text: kind === "install" ? "Installing Claude Code…" : "Opening Claude login…" });
  attachHelperOutput(proc, kind);
  proc.on("error", (err) => {
    // A cancelled-then-restarted helper's late events must not clobber the
    // live one: only the process that still owns `helper` may clear it.
    if (helper !== proc) return;
    helper = null;
    send("auth-log", { kind, text: err.message });
    send("auth-done", { kind, ok: false, error: err.message });
  });
  proc.on("close", async (code) => {
    if (helper !== proc) return;
    helper = null;
    const health = await getClaudeHealth(workspace);
    const ok = kind === "install" ? health.installed : health.loggedIn;
    send("auth-done", { kind, ok, code: code ?? 0, health });
  });
  return true;
}

function runClaude(prompt, { retried = false } = {}) {
  if (busy) {
    send("turn-error", { text: "Claude is already working. Stop the turn, or wait." });
    return;
  }

  if (!commandLooksInstalled(resolveCommand("claude"))) {
    send("turn-error", { text: MISSING_CLAUDE_TEXT });
    send("idle", snapshot());
    return;
  }

  const usedResume = Boolean(sessionId);
  const args = buildClaudeArgs(prompt, { sessionId });

  busy = true;
  streamedText = false;
  sawInit = false;
  stopRequested = false;
  turnText = "";
  toolNames.clear();
  const gen = ++turnGen;
  const superseded = () => gen <= resetGen;
  send("status", {
    text: sessionId
      ? `Continuing in the ${DESK_SESSION_NAME} Chrome group`
      : `Opening the ${DESK_SESSION_NAME} Chrome group`,
  });
  if (!retried) {
    send("user", { text: prompt });
    transcript.push({ role: "user", text: prompt });
  }

  child = spawnClaude(args, { cwd: workspace, detached: !IS_WIN });
  // Guard the async stream error too: the try/catch below only covers a
  // synchronous throw, and an EPIPE on a closed stdin would kill the desk.
  child.stdin?.on("error", () => {});
  try {
    child.stdin?.write("\n");
  } catch {
    // Print mode does not need stdin. This only dismisses a first-run Chrome prompt.
  }

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    if (superseded()) return;
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) handleStreamLine(line);
    }
  });
  child.stderr.on("data", (chunk) => {
    if (superseded()) return;
    const text = chunk.toString("utf8").trim();
    if (text) send("log", { text });
  });
  child.on("error", (err) => {
    busy = false;
    child = null;
    send("turn-error", {
      text:
        err.code === "ENOENT" ? MISSING_CLAUDE_TEXT : err.message,
    });
    send("idle", snapshot());
  });
  child.on("close", (code) => {
    // A child that outlived a /reset must still release busy, but its
    // buffered output, retry, and error reporting belong to the old
    // conversation and are dropped.
    if (!superseded() && buffer.trim()) handleStreamLine(buffer);
    busy = false;
    child = null;
    if (superseded()) {
      send("idle", snapshot());
      return;
    }
    if (!stopRequested && shouldRetryWithoutResume({ code, sawInit, usedResume, retried })) {
      sessionId = null;
      clearDeskSession(workspace);
      send("status", { text: "The saved session was stale. Starting a fresh one." });
      send("session", { sessionId: null, chromeGroup: snapshot().chromeGroup });
      runClaude(prompt, { retried: true });
      return;
    }
    if (turnText.trim()) {
      transcript.push({ role: "assistant", text: turnText });
      turnText = "";
    }
    const failure = exitErrorText(code, stopRequested);
    if (failure) send("turn-error", { text: failure });
    send("idle", snapshot());
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req)) || "{}");
  } catch {
    return null;
  }
}

// The actual bound port (the preferred port may be taken; startDesk scans up).
let boundPort = PORT;

function hostAllowed(host) {
  // Exact match only: a prefix check passes DNS-rebinding names like
  // 127.0.0.1.evil.com, which resolve here while the browser attaches
  // the attacker's cookies-free but Host-legitimate request.
  return host === `127.0.0.1:${boundPort}` || host === `localhost:${boundPort}`;
}

function originAllowed(origin) {
  // No Origin header = a non-browser local client (curl, the CLI). Browsers
  // always send Origin on cross-origin POSTs, which is the attack we gate:
  // any web page can fire a no-preflight POST at 127.0.0.1 and drive Claude
  // with permissions skipped. Same-origin desk requests carry our origin.
  if (!origin) return true;
  return origin === `http://127.0.0.1:${boundPort}` || origin === `http://localhost:${boundPort}`;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function createDeskServer() {
  return createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      // A handler throw must never take the desk down (in the app the
      // embedded server dying closes the whole desk).
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}

async function handleRequest(req, res) {
    if (!hostAllowed(req.headers.host || "")) {
      res.writeHead(403).end("localhost only");
      return;
    }
    if (req.method === "POST" && !originAllowed(req.headers.origin)) {
      res.writeHead(403).end("cross-origin requests are not allowed");
      return;
    }

    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: hello\ndata: ${JSON.stringify(snapshot(true))}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "GET" && url.pathname === "/workspace") {
      json(res, 200, { root: workspace });
      return;
    }

    if (req.method === "POST" && url.pathname === "/workspace/cli") {
      json(res, 200, startCli(workspace));
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/status") {
      json(res, 200, await getClaudeHealth(workspace));
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/meta") {
      json(res, 200, {
        chromeExtensionUrl: CHROME_EXTENSION_URL,
        claudeAiUrl: CLAUDE_AI_URL,
        pricingUrl: CLAUDE_PRICING_URL,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/install") {
      const started = runHelper("install", () => spawnOfficialInstall());
      json(res, started ? 202 : 409, { ok: started });
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/login") {
      const body = await readJson(req);
      if (!body) {
        json(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const started = runHelper("login", () => spawnSubscriptionLogin({ cwd: workspace, email }));
      json(res, started ? 202 : 409, { ok: started });
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/code") {
      const body = await readJson(req);
      if (!body) {
        json(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!helper || !helper.stdin?.writable || !code) {
        json(res, 400, { ok: false, error: "No login waiting for a code." });
        return;
      }
      helper.stdin.write(`${code}\n`);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/cancel") {
      stopHelper();
      send("auth-done", { kind: "cancel", ok: false });
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/send") {
      const body = await readJson(req);
      if (!body) {
        json(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        json(res, 400, { ok: false, error: "prompt required" });
        return;
      }
      runClaude(prompt);
      json(res, 202, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/stop") {
      stopClaude("Stopped this turn");
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/reset") {
      // Everything spawned so far belongs to the old conversation: its late
      // stdout must not re-save the session id it is still printing.
      resetGen = turnGen;
      stopClaude("New conversation. The Chrome group stays with this desk.");
      sessionId = null;
      transcript.length = 0;
      turnText = "";
      clearDeskSession(workspace);
      send("session", { sessionId: null, chromeGroup: snapshot().chromeGroup });
      send("reset", {});
      // A stopped turn sends its own idle from the close handler; an eager
      // idle here would re-enable Send while the old child still holds busy.
      if (!busy) send("idle", snapshot());
      json(res, 200, { ok: true });
      return;
    }

    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    if (file.includes("..")) {
      res.writeHead(400).end();
      return;
    }

    try {
      const path = join(PUBLIC, file.slice(1));
      const data = await readFile(path);
      res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
}

function openBrowser(href) {
  const detach = { detached: true, stdio: "ignore" };
  if (IS_WIN) {
    const chrome = spawn("cmd", ["/c", "start", "", "chrome", href], detach);
    chrome.on("error", () => spawn("cmd", ["/c", "start", "", href], detach).unref());
    chrome.unref();
    return;
  }
  if (IS_MAC) {
    const chrome = spawn("open", ["-a", "Google Chrome", href], detach);
    chrome.on("exit", (code) => {
      if (code) spawn("open", [href], detach).unref();
    });
    chrome.unref();
    return;
  }
  const linuxChrome = spawn("google-chrome", [href], detach);
  linuxChrome.on("error", () => {
    const chromium = spawn("chromium-browser", [href], detach);
    chromium.on("error", () => spawn("xdg-open", [href], detach).unref());
    chromium.unref();
  });
  linuxChrome.unref();
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.listen(port, host, onListening);
  });
}

export async function startDesk(options = {}) {
  workspace = resolveWorkspace({
    explicit: options.root || "",
    here: join(HERE, ".."),
  });
  if (!workspace) {
    throw new Error(existingWorkspaceHint());
  }
  rememberWorkspace(workspace);
  sessionId = loadDeskSession(workspace);
  const open = options.openBrowser ?? process.env.JOB_SEARCH_GUI_NO_BROWSER !== "1";
  const server = createDeskServer();

  const stop = (exitProcess = false) => {
    stopClaude("Desk closed");
    stopHelper();
    server.close(() => {
      if (exitProcess) process.exit(0);
    });
    if (exitProcess) setTimeout(() => process.exit(0), 500).unref();
  };

  process.on("SIGINT", () => stop(true));
  process.on("SIGTERM", () => stop(true));

  const preferred = Number(process.env.JOB_SEARCH_GUI_PORT || PORT);
  let bound = preferred;
  for (let offset = 0; offset < 10; offset += 1) {
    bound = preferred + offset;
    try {
      await listen(server, HOST, bound);
      break;
    } catch (err) {
      if (err.code !== "EADDRINUSE" || offset === 9) throw err;
    }
  }

  boundPort = bound;
  const href = `http://${HOST}:${bound}/`;
  console.log(`Job search desk: ${href}`);
  console.log(`Workspace: ${workspace}`);
  console.log("Same folder as node gui/server.mjs --cli. Scrapes, CVs, and applications stay here.");
  console.log("Claude Code runs locally with --dangerously-skip-permissions.");
  console.log("Localhost only. Close this window to stop.");
  if (open) openBrowser(href);
  return { href, server, workspace, stop, port: bound };
}

const launchedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (launchedDirectly) {
  const root = resolveWorkspace({ here: join(HERE, "..") });
  if (!root) {
    console.error(existingWorkspaceHint());
    process.exit(1);
  }
  rememberWorkspace(root);
  if (process.argv.includes("--cli")) {
    const started = startCli(root, { inherit: true });
    if (started.error) {
      console.error(started.error);
      process.exit(1);
    }
    started.child.on("exit", (code) => process.exit(code ?? 0));
  } else {
    startDesk({ root }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
