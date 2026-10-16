#!/usr/bin/env python3
"""Publish approved LinkedIn posts from a local queue through LinkedIn's official API.

`/linkedin` (the weekly check-in command) drafts posts into the queue
(~/.local/share/ai-job-search/linkedin/queue/, override LINKEDIN_QUEUE_DIR) and,
only once the user approves a draft, marks it `status: approved` with a
`scheduled_at` time. This tool is the only thing that ever talks to LinkedIn:

  auth          one-time OAuth login (opens a browser, catches the redirect on
                localhost), stores the token in ~/.config/ai-job-search/ (0600)
  whoami        shows who the stored token posts as, and when it expires
  status        lists the queue: id, type, status, scheduled time
  publish-due   posts every approved item whose time has come - at most one per
                run, never within MIN_GAP_HOURS of the previous post. Run by
                launchd every 30 minutes, so posting works with Claude closed.
  post <file>   publish one approved queue file now (still requires approval)

Safety rules, enforced here rather than trusted to the prompt:
  * only `status: approved` items are ever sent; drafts never leave the machine
  * a sent item is marked `posted` with its post URN before anything else runs,
    and a failed item is marked `failed` and never retried automatically, so a
    crash can never double-post
  * the token lives outside the repo; client id/secret come from env vars

Uses the Posts API (POST /rest/posts) with the `w_member_social` scope, and
OpenID Connect `userinfo` for the member id. Standard library only.
"""

from __future__ import annotations

import argparse
import html
import datetime as dt
import http.server
import json
import os
import re
import secrets
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from zoneinfo import ZoneInfo

# Outside the repo on purpose: the repo sits under ~/Desktop, which macOS (TCC)
# does not let a background launchd job read. The installer also copies this
# script next to the data for the same reason.
DATA = Path(os.environ.get("AIJS_DATA_DIR", Path.home() / ".local" / "share" / "ai-job-search"))
QUEUE = Path(os.environ.get("LINKEDIN_QUEUE_DIR", DATA / "linkedin" / "queue"))
TOKEN_FILE = Path(os.environ.get("LINKEDIN_TOKEN_FILE", Path.home() / ".config" / "ai-job-search" / "linkedin_token.json"))
TZ = ZoneInfo("Europe/Dublin")
REDIRECT = "http://localhost:8765/callback"
AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
USERINFO_URL = "https://api.linkedin.com/v2/userinfo"
POSTS_URL = "https://api.linkedin.com/rest/posts"
SCOPES = "openid profile w_member_social"
MIN_GAP_HOURS = 20
STATUSES = {"draft", "approved", "posted", "failed", "skipped"}
TYPES = {"project", "certification", "data-quality-lesson", "open-to-work", "other"}


class PostError(Exception):
    pass


# ---------------------------------------------------------------- queue files

def parse_item(path: Path) -> dict:
    """A queue file is `---` frontmatter (key: value lines) then the post text."""
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        raise PostError(f"{path.name}: missing --- frontmatter")
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    meta["body"] = m.group(2).strip()
    meta["path"] = path
    return meta


def write_item(item: dict) -> None:
    keys = ["id", "type", "status", "scheduled_at", "posted_at", "post_urn", "error"]
    head = "\n".join(f"{k}: {item.get(k, '')}" for k in keys if item.get(k, "") != "" or k in ("id", "type", "status", "scheduled_at"))
    tmp = item["path"].with_suffix(".tmp")
    tmp.write_text(f"---\n{head}\n---\n{item['body']}\n", encoding="utf-8")
    os.replace(tmp, item["path"])


def scheduled(item: dict) -> dt.datetime | None:
    raw = item.get("scheduled_at", "")
    if not raw:
        return None
    t = dt.datetime.fromisoformat(raw)
    return t if t.tzinfo else t.replace(tzinfo=TZ)


def load_queue(queue: Path = QUEUE) -> list[dict]:
    if not queue.is_dir():
        return []
    return sorted((parse_item(p) for p in queue.glob("*.md")), key=lambda i: i["path"].name)


def due_items(items: list[dict], now: dt.datetime) -> list[dict]:
    """Approved items whose time has passed, oldest first, honouring the posting gap."""
    posted = [dt.datetime.fromisoformat(i["posted_at"]) for i in items if i.get("status") == "posted" and i.get("posted_at")]
    last = max(posted) if posted else None
    if last and now - last < dt.timedelta(hours=MIN_GAP_HOURS):
        return []
    due = [i for i in items if i.get("status") == "approved" and scheduled(i) and scheduled(i) <= now]
    return sorted(due, key=scheduled)[:1]


# ---------------------------------------------------------------- post text

# LinkedIn's Posts API reads `commentary` as "little text": these characters
# are markup and must be backslash-escaped, or the post is silently truncated
# at the first one. Hashtags become the explicit {hashtag|\#|tag} template.
RESERVED = r"\|{}@[]()<>#*_~"


def escape_little_text(text: str) -> str:
    out = []
    for ch in text:
        out.append("\\" + ch if ch in RESERVED else ch)
    return "".join(out)


def to_commentary(body: str) -> str:
    parts = re.split(r"(?<![\w&])#([A-Za-z][A-Za-z0-9_]*)", body)
    out = []
    for i, part in enumerate(parts):
        if i % 2:
            out.append("{hashtag|\\#|" + part + "}")
        else:
            out.append(escape_little_text(part))
    return "".join(out)


def build_payload(body: str, person_id: str) -> dict:
    if not body.strip():
        raise PostError("empty post body")
    if len(body) > 3000:
        raise PostError(f"post is {len(body)} characters; LinkedIn's limit is 3000")
    return {
        "author": f"urn:li:person:{person_id}",
        "commentary": to_commentary(body),
        "visibility": "PUBLIC",
        "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }


# ---------------------------------------------------------------- token + HTTP

def load_token() -> dict:
    if not TOKEN_FILE.exists():
        raise PostError(f"no LinkedIn token at {TOKEN_FILE} - run: python3 tools/linkedin_post.py auth")
    tok = json.loads(TOKEN_FILE.read_text())
    if dt.datetime.fromtimestamp(tok["expires_at"], dt.timezone.utc) <= dt.datetime.now(dt.timezone.utc):
        raise PostError("LinkedIn token expired - run: python3 tools/linkedin_post.py auth")
    return tok


def save_token(tok: dict) -> None:
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = TOKEN_FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(tok, fh)
    os.replace(tmp, TOKEN_FILE)


def api_version(today: dt.date | None = None) -> str:
    """LinkedIn-Version header (YYYYMM). Versions are monthly and retired after
    about a year, so default to two months back; override with LINKEDIN_API_VERSION."""
    if os.environ.get("LINKEDIN_API_VERSION"):
        return os.environ["LINKEDIN_API_VERSION"]
    d = (today or dt.date.today()).replace(day=1) - dt.timedelta(days=45)
    return d.strftime("%Y%m")


def http_request(method: str, url: str, headers: dict, data: bytes | None = None) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def publish(body: str, tok: dict) -> str:
    payload = json.dumps(build_payload(body, tok["sub"])).encode()
    status, headers, raw = http_request("POST", POSTS_URL, {
        "Authorization": f"Bearer {tok['access_token']}",
        "LinkedIn-Version": api_version(),
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }, payload)
    if status != 201:
        raise PostError(f"LinkedIn returned HTTP {status}: {raw[:300].decode(errors='replace')}")
    lower = {k.lower(): v for k, v in headers.items()}
    return lower.get("x-restli-id") or lower.get("x-linkedin-id") or "unknown"


# ---------------------------------------------------------------- commands

def cmd_auth() -> int:
    cid, secret = os.environ.get("LINKEDIN_CLIENT_ID"), os.environ.get("LINKEDIN_CLIENT_SECRET")
    if not cid or not secret:
        print("Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET (e.g. in ~/.zshenv) first.", file=sys.stderr)
        return 2
    state = secrets.token_urlsafe(16)
    got: dict = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            got.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"LinkedIn login received - you can close this tab.")

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("localhost", 8765), Handler)
    threading.Thread(target=srv.handle_request, daemon=True).start()
    url = AUTH_URL + "?" + urllib.parse.urlencode({"response_type": "code", "client_id": cid, "redirect_uri": REDIRECT, "state": state, "scope": SCOPES})
    print("Opening LinkedIn login in your browser...")
    webbrowser.open(url)
    for _ in range(600):
        if got:
            break
        threading.Event().wait(0.5)
    srv.server_close()
    if got.get("state") != state or "code" not in got:
        reason = html.unescape(html.unescape(got.get('error_description') or got.get('error') or 'no response'))
        print(f"Login failed or timed out: {reason}", file=sys.stderr)
        if "openid" in reason or "w_member_social" in reason:
            print("Add both products on your app's Products tab - 'Sign In with LinkedIn using OpenID Connect' and 'Share on LinkedIn' - then run auth again.", file=sys.stderr)
        return 1
    status, _, raw = http_request("POST", TOKEN_URL, {"Content-Type": "application/x-www-form-urlencoded"}, urllib.parse.urlencode({
        "grant_type": "authorization_code", "code": got["code"], "redirect_uri": REDIRECT, "client_id": cid, "client_secret": secret}).encode())
    if status != 200:
        print(f"Token exchange failed: HTTP {status}", file=sys.stderr)
        return 1
    tok = json.loads(raw)
    status, _, raw = http_request("GET", USERINFO_URL, {"Authorization": f"Bearer {tok['access_token']}"})
    if status != 200:
        print(f"Could not read your LinkedIn member id: HTTP {status}", file=sys.stderr)
        return 1
    info = json.loads(raw)
    save_token({"access_token": tok["access_token"], "expires_at": int(dt.datetime.now(dt.timezone.utc).timestamp()) + int(tok.get("expires_in", 0)),
                "sub": info["sub"], "name": info.get("name", "")})
    print(f"Logged in as {info.get('name', info['sub'])}. Token saved to {TOKEN_FILE} (valid {int(tok.get('expires_in', 0)) // 86400} days).")
    return 0


def cmd_whoami() -> int:
    tok = load_token()
    exp = dt.datetime.fromtimestamp(tok["expires_at"], TZ)
    days = (exp - dt.datetime.now(TZ)).days
    print(f"Posting as {tok.get('name') or tok['sub']}; token expires {exp:%Y-%m-%d} ({days} days).")
    if days < 7:
        print("Token expires within a week - run auth again.")
    return 0


def cmd_status() -> int:
    items = load_queue()
    if not items:
        print("Queue is empty.")
        return 0
    for i in items:
        print(f"{i.get('id', i['path'].stem):40} {i.get('type', ''):20} {i.get('status', ''):9} {i.get('scheduled_at', '')}")
    return 0


def send(item: dict, tok: dict) -> None:
    try:
        urn = publish(item["body"], tok)
    except PostError as e:
        item.update(status="failed", error=str(e).replace("\n", " ")[:300])
        write_item(item)
        raise
    item.update(status="posted", posted_at=dt.datetime.now(TZ).isoformat(timespec="seconds"), post_urn=urn, error="")
    write_item(item)


def cmd_publish_due(now: dt.datetime | None = None) -> int:
    now = now or dt.datetime.now(TZ)
    due = due_items(load_queue(), now)
    if not due:
        return 0
    item = due[0]
    try:
        tok = load_token()
        send(item, tok)
    except PostError as e:
        print(f"{item['path'].name}: {e}", file=sys.stderr)
        _notify("LinkedIn post failed", f"{item.get('id')}: {e}"[:200])
        return 1
    print(f"Posted {item['path'].name} -> {item['post_urn']}")
    _notify("LinkedIn post published", item.get("id", item["path"].stem))
    return 0


def cmd_post(path: str) -> int:
    item = parse_item(Path(path))
    if item.get("status") != "approved":
        print(f"{Path(path).name} is '{item.get('status')}', not approved - nothing sent.", file=sys.stderr)
        return 1
    send(item, load_token())
    print(f"Posted {item['path'].name} -> {item['post_urn']}")
    return 0


def _notify(title: str, msg: str) -> None:
    """Best-effort macOS notification; silent elsewhere."""
    if sys.platform == "darwin":
        safe = lambda s: s.replace('"', "'").replace("\\", "")
        os.system(f'osascript -e "display notification \\"{safe(msg)}\\" with title \\"{safe(title)}\\"" >/dev/null 2>&1')


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("auth", "whoami", "status", "publish-due"):
        sub.add_parser(name)
    p = sub.add_parser("post")
    p.add_argument("file")
    args = ap.parse_args(argv)
    try:
        return {"auth": cmd_auth, "whoami": cmd_whoami, "status": cmd_status, "publish-due": cmd_publish_due}.get(args.cmd, lambda: cmd_post(args.file))()
    except PostError as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
