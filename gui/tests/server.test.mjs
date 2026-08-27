import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startDesk } from "../server.mjs";

// fetch() forbids overriding the Host header, so a raw request is the only way
// to exercise the host guard from a test.
function rawRequest(port, { method = "GET", path = "/", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}

// Boots the real desk server on an ephemeral port and drives its HTTP surface.
// Every assertion here exercises a guard that runs BEFORE any `claude` spawn,
// so no Claude Code process is started. These pin the 2026-08-27 hardening:
// cross-origin POSTs are drive-by command execution, and a malformed body used
// to crash the whole server on an unhandled JSON.parse throw.

const HERE = join(fileURLToPath(new URL(".", import.meta.url)));
const REPO_ROOT = join(HERE, "..", "..");

let desk;
let base;

before(async () => {
  process.env.JOB_SEARCH_GUI_NO_BROWSER = "1";
  process.env.JOB_SEARCH_GUI_PORT = "8791";
  desk = await startDesk({ root: REPO_ROOT, openBrowser: false });
  base = desk.href.replace(/\/$/, "");
});

after(() => {
  desk?.stop();
});

test("malformed JSON body answers 400, does not crash the server", async () => {
  const res = await fetch(`${base}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json at all",
  });
  assert.equal(res.status, 400);
  // The server is still up for the next request - the whole point.
  const alive = await fetch(`${base}/workspace`);
  assert.equal(alive.status, 200);
});

test("cross-origin POST is rejected with 403", async () => {
  const res = await fetch(`${base}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify({ prompt: "hi" }),
  });
  assert.equal(res.status, 403);
});

test("DNS-rebinding Host is rejected with 403", async () => {
  const status = await rawRequest(desk.port, {
    method: "POST",
    path: "/stop",
    headers: { Host: "127.0.0.1.evil.com" },
  });
  assert.equal(status, 403);
});

test("same-origin POST is allowed through the guard", async () => {
  const res = await fetch(`${base}/stop`, {
    method: "POST",
    headers: { Origin: base },
  });
  assert.equal(res.status, 200);
});

test("a GET with no Origin (curl, CLI) still works", async () => {
  const res = await fetch(`${base}/auth/meta`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok("chromeExtensionUrl" in body);
});
