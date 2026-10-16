#!/usr/bin/env python3
"""Turn approved cold emails into Gmail drafts (or send them over SMTP), and keep
the contact ledger that stops anyone being emailed twice.

Default flow (user's choice, 2026-10-16): `plan` lists the approved items that
may go out today, Claude sends each one with the Gmail connector's
send_message, and records it straight away with `record-sent`. Older modes stay
available: Gmail drafts (`record-draft`, then `confirm-sent` once the user
presses Send) and direct SMTP (`send`, needs an app password).

`/outreach daily` writes one file per email to outreach/queue/<YYYY-MM-DD>/ with
`status: draft`. Only the user's explicit approval in chat turns it into
`status: approved`; this tool sends approved items and nothing else.

  status                 today's queue and this month's totals
  plan                   approved items allowed out today (JSON), after every guard
  record-sent <file> <gmail_message_id> [<thread_id>]   approved item was sent via Gmail
  record-draft <file> <draft_id>     approved item is now a Gmail draft
  pending                drafts made but not yet confirmed sent (email, draft date)
  confirm-sent <email> <YYYY-MM-DD> [gmail_message_id]   user sent it from Gmail
  send [--dry-run]       SMTP alternative: send every approved item
  check <email>          has this address been contacted / suppressed?
  suppress <email>       never email this address again (opt-out, bounce, request)
  mark <email> <state>   record replied | bounced | opted_out for a contact
  followups [--days 7]   sent emails with no reply after N days, one follow-up max
  test                   send a test email to yourself

Guards (enforced here, not trusted to the prompt):
  * only `status: approved` items are sent, each exactly once; the item is
    marked `sent` with its Message-ID right after the SMTP call succeeds
  * an address in the ledger is never sent a new first email; a follow-up is
    allowed once, only after FOLLOWUP_DAYS with no reply
  * suppressed / replied / bounced / opted-out addresses are never emailed
  * at most DAILY_CAP sends per day, at most PER_DOMAIN_DAILY per company domain
  * SEND_GAP_SECONDS between sends (plain pacing, not evasion)

Credentials: GMAIL_ADDRESS and GMAIL_APP_PASSWORD (a Google app password, not
your normal password) from the environment only. Standard library only.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import email.utils
import os
import re
import smtplib
import ssl
import sys
import time
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get("OUTREACH_DIR", REPO / "outreach"))
QUEUE = ROOT / "queue"
LEDGER = ROOT / "contacts.csv"
TZ = ZoneInfo("Europe/Dublin")
DAILY_CAP = 25
PER_DOMAIN_DAILY = 2
SEND_GAP_SECONDS = 20
FOLLOWUP_DAYS = 7
LEDGER_FIELDS = ["email", "name", "company", "domain", "position", "found_via", "source", "drafted", "first_sent",
                 "last_sent", "steps", "status", "message_id", "gmail_message_id", "gmail_thread_id", "subject", "notes"]
CLOSED = {"replied", "bounced", "opted_out", "suppressed"}


class MailError(Exception):
    pass


# ---------------------------------------------------------------- queue items

def parse_item(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        raise MailError(f"{path.name}: missing --- frontmatter")
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    meta["body"] = m.group(2).strip()
    meta["path"] = path
    return meta


ITEM_KEYS = ["id", "to", "name", "company", "domain", "position", "step", "found_via", "source", "confidence",
             "subject", "status", "drafted_at", "draft_id", "sent_at", "message_id", "error", "in_reply_to",
             "reply_to_gmail_id", "reply_thread_id", "gmail_message_id", "gmail_thread_id"]


def write_item(item: dict) -> None:
    head = "\n".join(f"{k}: {item[k]}" for k in ITEM_KEYS if item.get(k) not in (None, ""))
    tmp = item["path"].with_suffix(".tmp")
    tmp.write_text(f"---\n{head}\n---\n{item['body']}\n", encoding="utf-8")
    os.replace(tmp, item["path"])


def load_queue(queue: Path | None = None) -> list[dict]:
    queue = queue or QUEUE
    if not queue.is_dir():
        return []
    return [parse_item(p) for p in sorted(queue.rglob("*.md"))]


# ---------------------------------------------------------------- ledger

def load_ledger(path: Path | None = None) -> dict[str, dict]:
    path = path or LEDGER
    if not path.exists():
        return {}
    with open(path, newline="", encoding="utf-8") as fh:
        return {r["email"].lower(): r for r in csv.DictReader(fh)}


def save_ledger(rows: dict[str, dict], path: Path | None = None) -> None:
    path = path or LEDGER
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=LEDGER_FIELDS)
        w.writeheader()
        for r in sorted(rows.values(), key=lambda r: r.get("last_sent") or ""):
            w.writerow({k: r.get(k, "") for k in LEDGER_FIELDS})
    os.replace(tmp, path)


def blocked_reason(item: dict, ledger: dict, now: dt.datetime) -> str | None:
    """Why this item must not be sent, or None if it may go."""
    to = (item.get("to") or "").lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", to):
        return f"bad address '{to}'"
    row = ledger.get(to)
    step = item.get("step", "first")
    if row and row.get("status") in CLOSED:
        return f"{to} is {row['status']}"
    if row and row.get("status") == "drafted":
        return f"{to} already has an unsent Gmail draft from {row['drafted'][:10]}"
    if step == "first" and row and row.get("first_sent"):
        return f"{to} was already emailed on {row['first_sent'][:10]}"
    if step == "first" and row and row.get("drafted"):
        return f"{to} already has a draft from {row['drafted'][:10]} (send it or mark it)"
    if step == "followup":
        if not row or not row.get("first_sent"):
            return "follow-up to someone never emailed"
        if int(row.get("steps") or 1) >= 2:
            return "already followed up once"
        last = dt.datetime.fromisoformat(row["last_sent"])
        if now - last < dt.timedelta(days=FOLLOWUP_DAYS):
            return f"follow-up too early (last sent {row['last_sent'][:10]})"
    return None


def sent_today(ledger: dict, now: dt.datetime) -> list[dict]:
    """Sent or drafted today - both count against the daily caps."""
    day = now.date().isoformat()
    return [r for r in ledger.values() if (r.get("last_sent") or "").startswith(day) or (r.get("drafted") or "").startswith(day)]


# ---------------------------------------------------------------- smtp

def credentials(env=os.environ) -> tuple[str, str]:
    addr, pw = (env.get("GMAIL_ADDRESS") or "").strip(), (env.get("GMAIL_APP_PASSWORD") or "").replace(" ", "")
    if not addr or not pw:
        raise MailError("set GMAIL_ADDRESS and GMAIL_APP_PASSWORD (a Google app password) in ~/.zshenv")
    return addr, pw


def build_message(item: dict, sender: str, sender_name: str = "Mohit Notani") -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = email.utils.formataddr((sender_name, sender))
    msg["To"] = email.utils.formataddr((item.get("name") or "", item["to"]))
    msg["Subject"] = item["subject"]
    msg["Date"] = email.utils.formatdate(localtime=True)
    msg["Message-ID"] = email.utils.make_msgid(domain=sender.split("@")[1])
    if item.get("in_reply_to"):
        msg["In-Reply-To"] = item["in_reply_to"]
        msg["References"] = item["in_reply_to"]
    msg.set_content(item["body"])
    return msg


def smtp_send(msgs: list[EmailMessage], sender: str, password: str) -> None:
    ctx = ssl.create_default_context()
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=60) as s:
        s.starttls(context=ctx)
        s.login(sender, password)
        for i, m in enumerate(msgs):
            if i:
                time.sleep(SEND_GAP_SECONDS)
            s.send_message(m)
            yield m


# ---------------------------------------------------------------- commands

def plan_today(ledger: dict, now: dt.datetime) -> tuple[list[dict], list[tuple[dict, str]]]:
    """Approved items allowed out today, and the ones blocked with the reason."""
    approved = [i for i in load_queue() if i.get("status") == "approved"]
    budget = DAILY_CAP - len(sent_today(ledger, now))
    per_domain: dict[str, int] = {}
    for r in sent_today(ledger, now):
        per_domain[r.get("domain", "")] = per_domain.get(r.get("domain", ""), 0) + 1
    plan, skipped = [], []
    for it in approved:
        why = blocked_reason(it, ledger, now)
        dom = (it.get("domain") or it["to"].split("@")[-1]).lower()
        if not why and len(plan) >= budget:
            why = f"daily cap of {DAILY_CAP} reached"
        if not why and per_domain.get(dom, 0) >= PER_DOMAIN_DAILY:
            why = f"already {PER_DOMAIN_DAILY} emails to {dom} today"
        if why:
            skipped.append((it, why))
            continue
        per_domain[dom] = per_domain.get(dom, 0) + 1
        plan.append(it)
    return plan, skipped


def cmd_plan(now: dt.datetime | None = None) -> int:
    import json
    now = now or dt.datetime.now(TZ)
    plan, skipped = plan_today(load_ledger(), now)
    print(json.dumps({
        "allowed": [{"file": str(i["path"]), "to": i["to"], "subject": i["subject"], "step": i.get("step", "first"),
                     "reply_thread_id": i.get("reply_thread_id", ""), "reply_to_gmail_id": i.get("reply_to_gmail_id", ""),
                     "body": i["body"]} for i in plan],
        "blocked": [{"file": str(i["path"]), "to": i.get("to"), "reason": why} for i, why in skipped]}, indent=2))
    return 0


def cmd_record_draft(path: str, draft_id: str, now: dt.datetime | None = None) -> int:
    now = now or dt.datetime.now(TZ)
    it = parse_item(Path(path))
    if it.get("status") != "approved":
        raise MailError(f"{Path(path).name} is '{it.get('status')}', not approved")
    ledger = load_ledger()
    why = blocked_reason(it, ledger, now)
    if why:
        raise MailError(f"{Path(path).name}: {why}")
    stamp = now.isoformat(timespec="seconds")
    it.update(status="in_gmail", drafted_at=stamp, draft_id=draft_id)
    write_item(it)
    to = it["to"].lower()
    row = ledger.get(to) or {"email": to, "steps": "0"}
    row.update(name=it.get("name", ""), company=it.get("company", ""), domain=it.get("domain", ""),
               position=it.get("position", ""), found_via=it.get("found_via", ""), source=it.get("source", ""),
               subject=it["subject"], drafted=stamp, status="drafted")
    ledger[to] = row
    save_ledger(ledger)
    print(f"Recorded Gmail draft for {to}")
    return 0


def cmd_record_sent(path: str, gmail_id: str, thread_id: str = "", now: dt.datetime | None = None) -> int:
    """Record an approved item that Claude just sent with the Gmail connector."""
    now = now or dt.datetime.now(TZ)
    it = parse_item(Path(path))
    if it.get("status") != "approved":
        raise MailError(f"{Path(path).name} is '{it.get('status')}', not approved")
    ledger = load_ledger()
    why = blocked_reason(it, ledger, now)
    if why:
        raise MailError(f"{Path(path).name}: {why} - it should not have been sent; record it by hand with `mark`")
    stamp = now.isoformat(timespec="seconds")
    it.update(status="sent", sent_at=stamp, gmail_message_id=gmail_id, gmail_thread_id=thread_id, error="")
    write_item(it)
    to = it["to"].lower()
    row = ledger.get(to) or {"email": to, "steps": "0"}
    row.update(name=it.get("name", ""), company=it.get("company", ""), domain=it.get("domain", ""),
               position=it.get("position", ""), found_via=it.get("found_via", ""), source=it.get("source", ""),
               subject=it["subject"], last_sent=stamp, steps=str(int(row.get("steps") or 0) + 1), status="sent",
               gmail_message_id=gmail_id, gmail_thread_id=thread_id or row.get("gmail_thread_id", ""))
    if not row.get("first_sent"):
        row["first_sent"] = stamp
    ledger[to] = row
    save_ledger(ledger)
    print(f"Recorded sent: {to}")
    return 0


def cmd_pending() -> int:
    rows = [r for r in load_ledger().values() if r.get("status") == "drafted"]
    for r in rows:
        print(f"{r['email']}\t{r.get('company', '')}\t{r['drafted'][:10]}\t{r.get('subject', '')}")
    if not rows:
        print("No unsent drafts.")
    return 0


def cmd_confirm_sent(addr: str, day: str, gmail_id: str = "") -> int:
    ledger = load_ledger()
    row = ledger.get(addr.lower())
    if not row:
        raise MailError(f"{addr} is not in the ledger")
    stamp = dt.datetime.fromisoformat(day).replace(hour=12, tzinfo=TZ).isoformat(timespec="seconds") if len(day) == 10 else day
    if not row.get("first_sent"):
        row["first_sent"] = stamp
    row.update(last_sent=stamp, steps=str(int(row.get("steps") or 0) + 1), status="sent",
               gmail_message_id=gmail_id or row.get("gmail_message_id", ""))
    ledger[addr.lower()] = row
    save_ledger(ledger)
    print(f"{addr}: sent {stamp[:10]} (step {row['steps']})")
    return 0


def cmd_send(dry_run: bool = False, now: dt.datetime | None = None, sender_fn=None) -> int:
    now = now or dt.datetime.now(TZ)
    ledger = load_ledger()
    if not any(i.get("status") == "approved" for i in load_queue()):
        print("Nothing approved to send.")
        return 0
    plan, skipped = plan_today(ledger, now)
    for it, why in skipped:
        print(f"SKIP {it['path'].name}: {why}")
    if dry_run or not plan:
        for it in plan:
            print(f"WOULD SEND {it['path'].name} -> {it['to']}")
        return 0
    sender, pw = credentials()
    msgs = [build_message(it, sender) for it in plan]
    send = sender_fn or smtp_send
    sent = 0
    try:
        for it, m in zip(plan, send(msgs, sender, pw)):
            stamp = dt.datetime.now(TZ).isoformat(timespec="seconds")
            it.update(status="sent", sent_at=stamp, message_id=m["Message-ID"], error="")
            write_item(it)
            to = it["to"].lower()
            row = ledger.get(to) or {"email": to, "steps": "0"}
            row.update(name=it.get("name", ""), company=it.get("company", ""), domain=it.get("domain", ""),
                       position=it.get("position", ""), found_via=it.get("found_via", ""), source=it.get("source", ""),
                       last_sent=stamp, steps=str(int(row.get("steps") or 0) + 1), status="sent",
                       message_id=m["Message-ID"], subject=it["subject"])
            if not row.get("first_sent"):
                row["first_sent"] = stamp
            ledger[to] = row
            save_ledger(ledger)
            sent += 1
            print(f"SENT {it['path'].name} -> {it['to']}")
    except (smtplib.SMTPException, OSError) as e:
        for it in plan[sent:]:
            if it.get("status") == "approved":
                it.update(status="failed", error=str(e)[:200])
                write_item(it)
        print(f"Stopped after {sent} sent: {e}", file=sys.stderr)
        return 1
    print(f"Sent {sent}; {len(skipped)} skipped.")
    return 0


def cmd_status(now: dt.datetime | None = None) -> int:
    now = now or dt.datetime.now(TZ)
    items = load_queue()
    by = {}
    for i in items:
        by[i.get("status", "?")] = by.get(i.get("status", "?"), 0) + 1
    ledger = load_ledger()
    month = now.strftime("%Y-%m")
    print(f"Queue: {by or 'empty'}")
    print(f"Sent today: {len(sent_today(ledger, now))}/{DAILY_CAP}   This month: "
          f"{sum(1 for r in ledger.values() if (r.get('last_sent') or '').startswith(month))}   "
          f"Replied: {sum(1 for r in ledger.values() if r.get('status') == 'replied')}   "
          f"Contacts in ledger: {len(ledger)}")
    return 0


def cmd_check(addr: str) -> int:
    row = load_ledger().get(addr.lower())
    print(f"{addr}: " + (f"{row['status']}, first {row.get('first_sent', '')[:10]}, steps {row.get('steps')}" if row else "never contacted"))
    return 0


def cmd_mark(addr: str, state: str) -> int:
    if state not in {"replied", "bounced", "opted_out", "suppressed", "sent"}:
        raise MailError("state must be replied, bounced, opted_out or suppressed")
    ledger = load_ledger()
    row = ledger.get(addr.lower()) or {"email": addr.lower(), "steps": "0"}
    row["status"] = state
    row["notes"] = (row.get("notes", "") + f" {state} {dt.date.today().isoformat()}").strip()
    ledger[addr.lower()] = row
    save_ledger(ledger)
    print(f"{addr}: {state}")
    return 0


def cmd_followups(days: int = FOLLOWUP_DAYS, now: dt.datetime | None = None) -> int:
    now = now or dt.datetime.now(TZ)
    due = [r for r in load_ledger().values()
           if r.get("status") == "sent" and int(r.get("steps") or 1) < 2 and r.get("last_sent")
           and now - dt.datetime.fromisoformat(r["last_sent"]) >= dt.timedelta(days=days)]
    for r in due:
        print(f"{r['email']}\t{r.get('name', '')}\t{r.get('company', '')}\t{r['last_sent'][:10]}\t"
              f"thread={r.get('gmail_thread_id', '')}\t{r.get('subject', '')}")
    if not due:
        print("No follow-ups due.")
    return 0


def cmd_test() -> int:
    sender, pw = credentials()
    item = {"to": sender, "name": "", "subject": "ai-job-search outreach test", "body": "Test message from tools/outreach_mail.py. SMTP works."}
    for _ in smtp_send([build_message(item, sender)], sender, pw):
        pass
    print(f"Test email sent to {sender}.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status"); sub.add_parser("test"); sub.add_parser("plan"); sub.add_parser("pending")
    p = sub.add_parser("record-sent"); p.add_argument("file"); p.add_argument("gmail_id"); p.add_argument("thread_id", nargs="?", default="")
    p = sub.add_parser("record-draft"); p.add_argument("file"); p.add_argument("draft_id")
    p = sub.add_parser("confirm-sent"); p.add_argument("email"); p.add_argument("day"); p.add_argument("gmail_id", nargs="?", default="")
    p = sub.add_parser("send"); p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("check"); p.add_argument("email")
    p = sub.add_parser("suppress"); p.add_argument("email")
    p = sub.add_parser("mark"); p.add_argument("email"); p.add_argument("state")
    p = sub.add_parser("followups"); p.add_argument("--days", type=int, default=FOLLOWUP_DAYS)
    a = ap.parse_args(argv)
    try:
        if a.cmd == "plan":
            return cmd_plan()
        if a.cmd == "record-sent":
            return cmd_record_sent(a.file, a.gmail_id, a.thread_id)
        if a.cmd == "record-draft":
            return cmd_record_draft(a.file, a.draft_id)
        if a.cmd == "pending":
            return cmd_pending()
        if a.cmd == "confirm-sent":
            return cmd_confirm_sent(a.email, a.day, a.gmail_id)
        if a.cmd == "send":
            return cmd_send(a.dry_run)
        if a.cmd == "status":
            return cmd_status()
        if a.cmd == "check":
            return cmd_check(a.email)
        if a.cmd == "suppress":
            return cmd_mark(a.email, "suppressed")
        if a.cmd == "mark":
            return cmd_mark(a.email, a.state)
        if a.cmd == "followups":
            return cmd_followups(a.days)
        return cmd_test()
    except MailError as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
