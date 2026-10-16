"""tools/linkedin_post.py: only approved posts leave the machine, once, on time."""

import datetime as dt
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import linkedin_post as lp  # noqa: E402

TZ = lp.TZ


def write(dirpath, name, status, scheduled="2026-10-20T08:30", extra="", body="Hello #DataQuality (test)"):
    p = Path(dirpath) / name
    p.write_text(f"---\nid: {p.stem}\ntype: project\nstatus: {status}\nscheduled_at: {scheduled}\n{extra}---\n{body}\n")
    return p


class Commentary(unittest.TestCase):
    def test_reserved_characters_are_escaped(self):
        self.assertEqual(lp.escape_little_text("a (b) [c] @d *e_"), r"a \(b\) \[c\] \@d \*e\_")

    def test_hashtags_use_the_template(self):
        self.assertEqual(lp.to_commentary("Ship it #dbt"), r"Ship it {hashtag|\#|dbt}")

    def test_a_hash_inside_a_word_is_not_a_hashtag(self):
        self.assertEqual(lp.to_commentary("C#"), r"C\#")

    def test_payload_shape(self):
        p = lp.build_payload("Hi", "abc")
        self.assertEqual(p["author"], "urn:li:person:abc")
        self.assertEqual(p["lifecycleState"], "PUBLISHED")
        self.assertEqual(p["visibility"], "PUBLIC")

    def test_limits(self):
        with self.assertRaises(lp.PostError):
            lp.build_payload("   ", "x")
        with self.assertRaises(lp.PostError):
            lp.build_payload("x" * 3001, "x")


class Due(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.now = dt.datetime(2026, 10, 20, 9, 0, tzinfo=TZ)

    def test_only_approved_and_past_due(self):
        write(self.d, "a.md", "draft")
        write(self.d, "b.md", "approved", scheduled="2026-10-22T08:30")
        write(self.d, "c.md", "approved")
        due = lp.due_items(lp.load_queue(Path(self.d)), self.now)
        self.assertEqual([i["path"].name for i in due], ["c.md"])

    def test_one_per_run(self):
        write(self.d, "a.md", "approved", scheduled="2026-10-19T08:30")
        write(self.d, "b.md", "approved")
        self.assertEqual(len(lp.due_items(lp.load_queue(Path(self.d)), self.now)), 1)

    def test_gap_after_a_recent_post(self):
        write(self.d, "a.md", "posted", extra="posted_at: 2026-10-20T07:00:00+01:00\n")
        write(self.d, "b.md", "approved")
        self.assertEqual(lp.due_items(lp.load_queue(Path(self.d)), self.now), [])

    def test_failed_is_never_retried(self):
        write(self.d, "a.md", "failed")
        self.assertEqual(lp.due_items(lp.load_queue(Path(self.d)), self.now), [])


class Send(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.tok = {"access_token": "t", "sub": "abc", "expires_at": 4102444800}

    def test_success_marks_posted_with_urn(self):
        p = write(self.d, "a.md", "approved")
        with mock.patch.object(lp, "http_request", return_value=(201, {"x-restli-id": "urn:li:share:1"}, b"")):
            lp.send(lp.parse_item(p), self.tok)
        item = lp.parse_item(p)
        self.assertEqual((item["status"], item["post_urn"]), ("posted", "urn:li:share:1"))
        self.assertIn("#DataQuality", item["body"])

    def test_failure_marks_failed(self):
        p = write(self.d, "a.md", "approved")
        with mock.patch.object(lp, "http_request", return_value=(401, {}, b"bad token")):
            with self.assertRaises(lp.PostError):
                lp.send(lp.parse_item(p), self.tok)
        self.assertEqual(lp.parse_item(p)["status"], "failed")

    def test_post_command_refuses_unapproved(self):
        p = write(self.d, "a.md", "draft")
        with mock.patch.object(lp, "http_request") as h:
            self.assertEqual(lp.cmd_post(str(p)), 1)
            h.assert_not_called()


class AuthPlumbing(unittest.TestCase):
    def test_http_module_is_not_shadowed(self):
        # A helper named `http` once hid the stdlib module and crashed `auth`.
        self.assertTrue(hasattr(lp.http.server, "BaseHTTPRequestHandler"))


class Version(unittest.TestCase):
    def test_header_is_a_recent_month(self):
        self.assertEqual(lp.api_version(dt.date(2026, 10, 15)), "202608")


if __name__ == "__main__":
    unittest.main()
