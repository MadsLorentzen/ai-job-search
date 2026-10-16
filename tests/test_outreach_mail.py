"""tools/outreach_mail.py and tools/hunter.py: approved-only, once-only, capped sending."""

import datetime as dt
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import hunter  # noqa: E402
import outreach_mail as om  # noqa: E402

NOW = dt.datetime(2026, 10, 16, 10, 0, tzinfo=om.TZ)


def item(d, name, to, status="approved", step="first", domain=None, extra=""):
    p = Path(d) / "queue" / "2026-10-16" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    dom = domain or to.split("@")[1]
    p.write_text(f"---\nid: {p.stem}\nto: {to}\nname: Jane Doe\ncompany: Acme\ndomain: {dom}\nstep: {step}\n"
                 f"subject: Data quality analyst in Dublin\nstatus: {status}\n{extra}---\nHi Jane,\n\nBody.\n")
    return p


def fake_sender(msgs, sender, pw):
    for m in msgs:
        yield m


class Base(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        patches = [mock.patch.object(om, "QUEUE", Path(self.d) / "queue"),
                   mock.patch.object(om, "LEDGER", Path(self.d) / "contacts.csv"),
                   mock.patch.dict(os.environ, {"GMAIL_ADDRESS": "me@gmail.com", "GMAIL_APP_PASSWORD": "abcd efgh"})]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def send(self):
        return om.cmd_send(now=NOW, sender_fn=fake_sender)


def _ll(d):
    import csv
    p = Path(d) / "contacts.csv"
    if not p.exists():
        return {}
    with open(p, newline="") as fh:
        return {r["email"]: r for r in csv.DictReader(fh)}


def _sl(d, rows):
    import csv
    with open(Path(d) / "contacts.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=om.LEDGER_FIELDS)
        w.writeheader()
        for r in rows.values():
            w.writerow({k: r.get(k, "") for k in om.LEDGER_FIELDS})


class Sending(Base):
    def test_only_approved_items_are_sent_and_marked(self):
        a = item(self.d, "a.md", "jane@acme.ie")
        b = item(self.d, "b.md", "joe@beta.ie", status="draft")
        self.assertEqual(self.send(), 0)
        self.assertEqual(om.parse_item(a)["status"], "sent")
        self.assertTrue(om.parse_item(a)["message_id"].startswith("<"))
        self.assertEqual(om.parse_item(b)["status"], "draft")
        self.assertIn("jane@acme.ie", _ll(self.d))

    def test_never_a_second_first_email(self):
        item(self.d, "a.md", "jane@acme.ie")
        self.send()
        c = item(self.d, "c.md", "jane@acme.ie")
        self.send()
        self.assertEqual(om.parse_item(c)["status"], "approved")  # skipped, not sent

    def test_suppressed_address_is_skipped(self):
        _sl(self.d, {"x@acme.ie": {"email": "x@acme.ie", "status": "opted_out"}})
        p = item(self.d, "a.md", "x@acme.ie")
        self.send()
        self.assertEqual(om.parse_item(p)["status"], "approved")

    def test_per_domain_daily_cap(self):
        ps = [item(self.d, f"{i}.md", f"p{i}@acme.ie") for i in range(3)]
        self.send()
        self.assertEqual([om.parse_item(p)["status"] for p in ps].count("sent"), om.PER_DOMAIN_DAILY)

    def test_smtp_failure_marks_the_rest_failed(self):
        ps = [item(self.d, f"{i}.md", f"p{i}@d{i}.ie") for i in range(2)]

        def boom(msgs, sender, pw):
            yield msgs[0]
            raise om.smtplib.SMTPException("connection dropped")

        self.assertEqual(om.cmd_send(now=NOW, sender_fn=boom), 1)
        self.assertEqual([om.parse_item(p)["status"] for p in ps], ["sent", "failed"])


class DraftFlow(Base):
    def test_draft_then_confirm(self):
        a = item(self.d, "a.md", "jane@acme.ie")
        self.assertEqual(om.cmd_record_draft(str(a), "r-123", now=NOW), 0)
        it = om.parse_item(a)
        self.assertEqual((it["status"], it["draft_id"]), ("in_gmail", "r-123"))
        self.assertEqual(_ll(self.d)["jane@acme.ie"]["status"], "drafted")
        # a second first email to the same person is blocked while the draft is unsent
        b = item(self.d, "b.md", "jane@acme.ie")
        with self.assertRaises(om.MailError):
            om.cmd_record_draft(str(b), "r-456", now=NOW)
        om.cmd_confirm_sent("jane@acme.ie", "2026-10-16", "18f00")
        row = _ll(self.d)["jane@acme.ie"]
        self.assertEqual((row["status"], row["steps"], row["first_sent"][:10]), ("sent", "1", "2026-10-16"))
        # and after sending, still never a second first email
        with self.assertRaises(om.MailError):
            om.cmd_record_draft(str(b), "r-789", now=NOW)

    def test_unapproved_cannot_become_a_draft(self):
        a = item(self.d, "a.md", "jane@acme.ie", status="draft")
        with self.assertRaises(om.MailError):
            om.cmd_record_draft(str(a), "r-1", now=NOW)

    def test_drafts_count_against_the_domain_cap(self):
        for i in range(2):
            om.cmd_record_draft(str(item(self.d, f"{i}.md", f"p{i}@acme.ie")), f"r{i}", now=NOW)
        item(self.d, "x.md", "p9@acme.ie")
        plan, skipped = om.plan_today(_ll(self.d), NOW)
        self.assertEqual(plan, [])
        self.assertIn("acme.ie", skipped[0][1])


class SentFlow(Base):
    def test_record_sent_then_never_again(self):
        a = item(self.d, "a.md", "jane@acme.ie")
        self.assertEqual(om.cmd_record_sent(str(a), "18f1", "th1", now=NOW), 0)
        it = om.parse_item(a)
        self.assertEqual((it["status"], it["gmail_message_id"]), ("sent", "18f1"))
        row = _ll(self.d)["jane@acme.ie"]
        self.assertEqual((row["status"], row["steps"], row["gmail_thread_id"]), ("sent", "1", "th1"))
        b = item(self.d, "b.md", "jane@acme.ie")
        self.assertIn("already emailed", om.blocked_reason(om.parse_item(b), _ll(self.d), NOW))

    def test_unapproved_cannot_be_recorded_sent(self):
        a = item(self.d, "a.md", "jane@acme.ie", status="draft")
        with self.assertRaises(om.MailError):
            om.cmd_record_sent(str(a), "x", now=NOW)


class FollowUps(unittest.TestCase):
    def test_rules(self):
        ledger = {"j@a.ie": {"email": "j@a.ie", "first_sent": "2026-10-01T10:00:00+01:00",
                             "last_sent": "2026-10-01T10:00:00+01:00", "steps": "1", "status": "sent"}}
        fu = {"to": "j@a.ie", "step": "followup"}
        self.assertIsNone(om.blocked_reason(fu, ledger, NOW))
        ledger["j@a.ie"]["last_sent"] = "2026-10-14T10:00:00+01:00"
        self.assertIn("too early", om.blocked_reason(fu, ledger, NOW))
        ledger["j@a.ie"]["steps"] = "2"
        self.assertIn("already followed up", om.blocked_reason(fu, ledger, NOW))
        self.assertIn("never emailed", om.blocked_reason({"to": "n@a.ie", "step": "followup"}, {}, NOW))


class Message(unittest.TestCase):
    def test_threading_headers(self):
        m = om.build_message({"to": "j@a.ie", "name": "Jane", "subject": "Re: x", "body": "hi",
                              "in_reply_to": "<abc@gmail.com>"}, "me@gmail.com")
        self.assertEqual(m["In-Reply-To"], "<abc@gmail.com>")
        self.assertIn("Mohit Notani", m["From"])

    def test_missing_credentials(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(om.MailError):
                om.credentials()


class Hunter(unittest.TestCase):
    REC = {"value": "Jane.Doe@Acme.ie", "type": "personal", "confidence": 94, "first_name": "Jane", "last_name": "Doe",
           "position": "Talent Acquisition Partner", "sources": [{"uri": "https://acme.ie/team"}],
           "verification": {"status": "valid"}}

    def test_normalise(self):
        c = hunter.normalise(self.REC, "Acme", "acme.ie")
        self.assertEqual((c["email"], c["name"], c["published"]), ("jane.doe@acme.ie", "Jane Doe", True))
        self.assertTrue(hunter.is_recruiter(c))

    def test_sendable_rules(self):
        c = hunter.normalise(self.REC)
        self.assertTrue(hunter.sendable(c))
        guess = dict(c, verification="unknown", published=False)
        self.assertFalse(hunter.sendable(guess))
        accept_all_published = dict(c, verification="accept_all", confidence=95)
        self.assertTrue(hunter.sendable(accept_all_published))
        accept_all_guess = dict(c, verification="accept_all", published=False)
        self.assertFalse(hunter.sendable(accept_all_guess))

    def test_recruiters_sort_first(self):
        data = {"data": {"organization": "Acme", "domain": "acme.ie", "emails": [
            dict(self.REC, value="ceo@acme.ie", position="Chief People Officer", confidence=99),
            self.REC]}}
        with mock.patch.object(hunter, "call", return_value=data):
            res = hunter.domain_search("acme.ie", "k")
        self.assertEqual(res[0]["email"], "jane.doe@acme.ie")

    def test_missing_key(self):
        with self.assertRaises(hunter.HunterError):
            hunter.key({})


if __name__ == "__main__":
    unittest.main()
