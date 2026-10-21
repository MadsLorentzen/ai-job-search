"""tools/fetch_page.py is the browser-header retry from 09-web-research.md.

Why this test exists: the retry used to be a documented `curl` invocation plus
an inline `python3 -c` tag-stripper, which meant the workflow needed a
`Bash(curl:*)` grant - and `curl` with a free tail is an upload channel. The
script replaces both with one GET-only command whose argv is fixed, that
enforces the robots.txt gate itself, and that refuses to write inside the
repo. These tests pin each of those properties against a real local server.
"""
import contextlib
import http.server
import io
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))
import fetch_page  # noqa: E402

PAGE = (
    "<!doctype html><html><head><title>Posting</title>"
    "<style>.x{color:red}</style>"
    "<script>alert('tracking')</script></head>"
    "<body><!-- hidden comment -->"
    "<h1>Visible&nbsp;title</h1><p>Visible text &amp; more.</p>"
    "<noscript>noscript text</noscript><svg><text>svg text</text></svg>"
    "</body></html>"
)
KOREAN_PAGE = (
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=euc-kr">'
    "<title>채용공고</title></head><body><h1>백엔드 개발자 채용</h1></body></html>"
)
CONTENT_TYPES = {"/euc-kr.html": "text/html; charset=euc-kr"}


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (http.server naming)
        if self.path == "/ok.html":
            body = PAGE.encode("utf-8")
            self.send_response(200)
        elif self.path == "/euc-kr.html":
            body = KOREAN_PAGE.encode("cp949")
            self.send_response(200)
        elif self.path == "/forbidden":
            body = b"<html><body>denied</body></html>"
            self.send_response(403)
        elif self.path in ("/loop1", "/loop2"):
            self.send_response(302)
            self.send_header("Location", "/loop2" if self.path == "/loop1" else "/loop1")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        elif self.path == "/gzip-big":
            import gzip as _gzip
            body = _gzip.compress(b"<p>" + b"x" * 5000 + b"</p>")
            self.send_response(200)
            self.send_header("Content-Encoding", "gzip")
        else:
            body = b"nope"
            self.send_response(404)
        self.send_header("Content-Type", CONTENT_TYPES.get(self.path, "text/html; charset=utf-8"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep test output pristine
        pass


class FetchPageFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.out = self.tmp / "page.html"
        self.gate_calls = []
        self._orig_gate = fetch_page.gate
        fetch_page.gate = self.allow_gate
        self.addCleanup(setattr, fetch_page, "gate", self._orig_gate)

    def allow_gate(self, url):
        self.gate_calls.append(url)
        return 0, "ALLOWED - robots.txt permits this path"

    def run_main(self, *argv):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = fetch_page.main(list(argv))
        return code, stdout.getvalue(), stderr.getvalue()


class SchemeAndPathGuards(FetchPageFixture):
    def test_rejects_non_http_scheme(self):
        code, out, err = self.run_main("file:///etc/passwd", "--out", str(self.out))
        self.assertEqual(code, 2)
        self.assertIn("http(s)", err)
        self.assertFalse(self.out.exists())
        self.assertEqual(self.gate_calls, [])

    def test_refuses_out_inside_repo_before_any_network(self):
        fetch_page.gate = lambda url: self.fail("gate must not run for a refused --out")
        inside = REPO_ROOT / "cv" / "fetched.html"
        code, out, err = self.run_main(f"{self.base}/ok.html", "--out", str(inside))
        self.assertEqual(code, 2)
        self.assertIn("inside the repo", err)
        self.assertFalse(inside.exists())


class RobotsGate(FetchPageFixture):
    def test_refuses_when_robots_gate_denies(self):
        fetch_page.gate = lambda url: (1, "DISALLOWED for * - do not retry, go to step 3")
        code, out, err = self.run_main(f"{self.base}/ok.html", "--out", str(self.out))
        self.assertEqual(code, 1)
        self.assertIn("DISALLOWED", out)
        self.assertIn("escalation step 4", out)
        self.assertFalse(self.out.exists())

    def test_gate_sees_the_requested_url(self):
        self.run_main(f"{self.base}/ok.html", "--out", str(self.out))
        self.assertEqual(self.gate_calls, [f"{self.base}/ok.html"])


class Fetching(FetchPageFixture):
    def test_fetches_and_reports_status(self):
        code, out, err = self.run_main(f"{self.base}/ok.html", "--out", str(self.out))
        self.assertEqual(code, 0, err)
        self.assertIn("HTTP 200 size=", out)
        self.assertIn(f"saved={self.out}", out)
        self.assertEqual(self.out.read_text(encoding="utf-8"), PAGE)

    def test_non_200_is_reported_not_fatal(self):
        # The status is information for the escalation order, not a failure:
        # a 403 body still tells the agent what the site answered.
        code, out, err = self.run_main(f"{self.base}/forbidden", "--out", str(self.out))
        self.assertEqual(code, 0, err)
        self.assertIn("HTTP 403", out)
        self.assertIn("denied", self.out.read_text(encoding="utf-8"))

    def test_text_strips_script_style_comments_and_unescapes(self):
        code, out, err = self.run_main(f"{self.base}/ok.html", "--out", str(self.out), "--text")
        self.assertEqual(code, 0, err)
        text = out.split("--- text ---", 1)[1]
        self.assertIn("Visible title", text)
        self.assertIn("Visible text & more.", text)
        for leaked in ("alert(", "color:red", "hidden comment", "noscript text", "svg text", "<p>"):
            self.assertNotIn(leaked, text)

    def test_text_decodes_a_page_by_its_declared_charset(self):
        code, out, err = self.run_main(f"{self.base}/euc-kr.html", "--out", str(self.out), "--text")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.out.read_bytes(), KOREAN_PAGE.encode("cp949"))
        text = out.split("--- text ---", 1)[1]
        self.assertIn("백엔드 개발자 채용", text)
        self.assertNotIn("\ufffd", text)

    def test_max_chars_caps_text(self):
        code, out, err = self.run_main(
            f"{self.base}/ok.html", "--out", str(self.out), "--text", "--max-chars", "7"
        )
        self.assertEqual(code, 0, err)
        text = out.split("--- text ---", 1)[1].strip()
        self.assertLessEqual(len(text), 7)
        self.assertTrue(text)

    def test_default_out_lands_in_temp_not_repo(self):
        code, out, err = self.run_main(f"{self.base}/ok.html")
        self.assertEqual(code, 0, err)
        saved = Path(out.split("saved=", 1)[1].strip())
        self.addCleanup(saved.unlink)
        self.assertTrue(saved.exists())
        with self.assertRaises(ValueError):
            saved.resolve().relative_to(REPO_ROOT)

    def _without_curl(self):
        orig_which = fetch_page.shutil.which
        fetch_page.shutil.which = lambda name: None
        self.addCleanup(setattr, fetch_page.shutil, "which", orig_which)

    def test_redirect_loop_is_a_transport_error_on_both_paths(self):
        # The docstring promises "5 redirects"; a loop must end in exit 2 with
        # nothing claimed as fetched, with or without curl installed.
        for label in ("curl", "urllib"):
            with self.subTest(path=label):
                if label == "urllib":
                    self._without_curl()
                code, out, err = self.run_main(f"{self.base}/loop1", "--out", str(self.out))
                self.assertEqual(code, 2, out + err)
                self.assertNotIn("saved=", out)

    def test_decompressed_size_is_bounded_on_urllib_path(self):
        # The 10 MB cap must apply after Content-Encoding is undone, or a small
        # gzip body can expand past it. MAX_BYTES is lowered to make it testable.
        self._without_curl()
        orig_max = fetch_page.MAX_BYTES
        fetch_page.MAX_BYTES = 1000
        self.addCleanup(setattr, fetch_page, "MAX_BYTES", orig_max)
        code, out, err = self.run_main(f"{self.base}/gzip-big", "--out", str(self.out))
        self.assertEqual(code, 2, out + err)
        self.assertIn("exceeds", err)
        self.assertFalse(self.out.exists())

    def test_urllib_fallback_when_curl_missing(self):
        orig_which = fetch_page.shutil.which
        fetch_page.shutil.which = lambda name: None
        self.addCleanup(setattr, fetch_page.shutil, "which", orig_which)
        code, out, err = self.run_main(f"{self.base}/ok.html", "--out", str(self.out), "--text")
        self.assertEqual(code, 0, err)
        self.assertIn("HTTP 200 size=", out)
        self.assertEqual(self.out.read_text(encoding="utf-8"), PAGE)
        self.assertIn("Visible title", out)


class CurlArgvShape(unittest.TestCase):
    """The grant is `Bash(python tools/fetch_page.py:*)`, so what curl is handed
    is the whole security property: GET only, no body, no upload, and the URL
    can never be parsed as an option."""

    def test_curl_argv_is_get_only_and_terminates_options(self):
        url = "-https://example.com/x"  # a URL that would read as a flag
        argv = fetch_page.build_curl_argv(url, Path("out.html"))
        self.assertEqual(argv[0], "curl")
        self.assertEqual(argv[-2:], ["--", url])
        for forbidden in ("-d", "--data", "--data-binary", "--data-raw", "-F", "--form",
                          "-T", "--upload-file", "-X", "--request", "-u", "--user", "-K"):
            self.assertNotIn(forbidden, argv[:-1])
        self.assertIn("--max-filesize", argv)
        self.assertIn("--max-redirs", argv)
        self.assertIn("-A", argv)
        self.assertEqual(argv[argv.index("-A") + 1], fetch_page.BROWSER)

    def test_user_agent_is_the_one_robots_check_uses(self):
        import robots_check
        self.assertEqual(fetch_page.BROWSER, robots_check.BROWSER)


if __name__ == "__main__":
    unittest.main()
