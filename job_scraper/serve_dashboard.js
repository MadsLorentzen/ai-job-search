#!/usr/bin/env bun
// Serves the job dashboard live over HTTP - the only way this dashboard exists. A
// bookmarked file:// page has no way to write local files, so a server is what makes
// the Apply / status-update controls actually work; there is no static-export mode.
// Bookmark the URL this prints (http://127.0.0.1:<port>/ by default).
//
// GET / returns a fixed static shell (dashboard_lib.js's SHELL_HTML - identical bytes
// every time, nothing to build). The client fetches GET /api/data itself on load and
// after every write, and that endpoint rebuilds fresh from disk on every call - so
// there is no "regenerate after /scrape or /rank" step to remember while this is
// running, just reload the tab. POST /api/status mirrors /outcome's Step 4 rules
// exactly: status + date-corrected-on-leaving-drafted + a dated note appended, never
// restructuring the CSV - so anything updated here stays fully compatible with
// /outcome if you use it later for richer outcome recording (interview stage tracking,
// feedback capture, document archiving under documents/applications/).
//
// Binds to 127.0.0.1 only, deliberately never 0.0.0.0 - this endpoint writes to disk
// on an unauthenticated request, which is fine for a single-user localhost tool and
// not fine exposed to your LAN.

import { buildDashboardData, SHELL_HTML, updateTrackerStatus, VALID_STATUSES } from "./dashboard_lib.js"

const PROJECT_ROOT = new URL("../", import.meta.url)
const PORT = Number(process.env.PORT) || 4321

/** Only ever serve compiled PDFs out of these two known directories, and never anything reached via ".." - this server has no auth, so path traversal here would be a real local-file-disclosure bug, not just a correctness one. */
function isSafeStaticPath(pathname) {
  if (pathname.includes("..")) return false
  return /^\/(cv|cover_letters)\//.test(pathname)
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/" && req.method === "GET") {
      // no-store: this shell embeds the client JS inline, so a browser silently serving a
      // cached copy on plain refresh would make every future fix here look like it "didn't
      // work" even though the server was updated - this endpoint must always be re-fetched.
      return new Response(SHELL_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
    }

    if (url.pathname === "/api/data" && req.method === "GET") {
      const data = await buildDashboardData()
      return Response.json(data, { headers: { "cache-control": "no-store" } })
    }

    if (url.pathname === "/api/status" && req.method === "POST") {
      let body
      try {
        body = await req.json()
      } catch {
        return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
      }
      const { company, role, status, note, url: source, rank_score } = body ?? {}
      if (!VALID_STATUSES.includes(status)) {
        return Response.json({ ok: false, error: `Unknown status "${status}". Valid: ${VALID_STATUSES.join(", ")}` }, { status: 400 })
      }
      const result = await updateTrackerStatus({ company, role, status, note, source, fit_rating: rank_score })
      return Response.json(result, { status: result.ok ? 200 : 400 })
    }

    if (isSafeStaticPath(url.pathname) && req.method === "GET") {
      const filePath = new URL("." + url.pathname, PROJECT_ROOT)
      const file = Bun.file(filePath)
      if (await file.exists()) return new Response(file)
      return new Response("Not found", { status: 404 })
    }

    return new Response("Not found", { status: 404 })
  },
})

console.log(`Job Search Dashboard running at http://127.0.0.1:${server.port}/`)
console.log("Bookmark that URL for a live, writable dashboard. Ctrl+C to stop.")
