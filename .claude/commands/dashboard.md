# /dashboard - Start (or Reuse) the Live Job Dashboard

You are getting the local job-search dashboard up and visible in the user's browser. This command wraps `job_scraper/serve_dashboard.js` - see that file and `job_scraper/dashboard_lib.js` for what the dashboard actually does (filterable/sortable table, an Apply button, status updates that write straight to `job_search_tracker.csv`). This command's only job is: make sure the server is running, then open it - it does not touch any data itself.

`$ARGUMENTS` may contain a port number (e.g. `/dashboard 5000`) to use instead of the default `4321`. Otherwise proceed with `4321`.

---

## Step 1: Check Whether It's Already Running

Never start a second server on a port that's already serving the dashboard - it fails with an address-in-use error, and if the user already has a tab open, restarting for no reason is unnecessary churn. Check first:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<port>/api/data --max-time 2
```

- **`200`** → already running. Skip Step 2, go straight to Step 3.
- **Anything else** (connection refused, timeout, non-200) → not running. Continue to Step 2.

---

## Step 2: Start the Server

This is a long-lived process that never exits on its own - **always start it in the background**, never in the foreground, or the command will hang for the rest of the session.

```bash
bun run job_scraper/serve_dashboard.js
```

(Prefix with `PORT=<port>` if a non-default port was requested in `$ARGUMENTS`, e.g. `PORT=5000 bun run job_scraper/serve_dashboard.js`.)

**If this fails with exit code 127 ("command not found"):** `bun` is likely installed but not on this shell's `PATH`. Retry with the full path instead: `"$HOME/.bun/bin/bun" run job_scraper/serve_dashboard.js` (or the platform-appropriate install location) rather than retrying the bare `bun run ...` command a second time.

Check the background output for the line `Job Search Dashboard running at http://127.0.0.1:<port>/` before proceeding, to confirm it actually started. If it failed instead (port already in use by something unrelated, a syntax error in the server code, etc.), report the real error to the user rather than silently opening a browser tab to a dead server.

---

## Step 3: Open the Browser

```bash
powershell -Command "Start-Process 'http://127.0.0.1:<port>/'"
```

This repo's dev environment is Windows, so `Start-Process` via PowerShell is the default opener. If run on macOS or Linux instead, use `open http://127.0.0.1:<port>/` or `xdg-open http://127.0.0.1:<port>/` respectively.

**This always opens a new tab - it cannot refresh or focus an already-open one.** There is no reliable way to target a specific existing browser tab from a shell command. If Step 1 found the server already running, tell the user it's likely already open in a tab somewhere and they may prefer to switch to it and press F5 rather than opening a duplicate - but still open it if they ask, since you can't know for certain a tab is still open.

---

## Step 4: Confirm

Tell the user:
- Whether the server was already running or just started
- The URL (`http://127.0.0.1:<port>/`) - worth bookmarking if they haven't
- That it stays live only as long as this background process keeps running for the session; closing the terminal / ending the session stops it, and the next `/dashboard` call will restart it

---

## Important Rules

1. **Never run the server in the foreground.** It has no natural exit point.
2. **Never start a duplicate on an already-occupied port** - always check first (Step 1).
3. **This command never modifies data.** It only starts a process and opens a URL; all reads/writes happen inside the server itself (`dashboard_lib.js`).
