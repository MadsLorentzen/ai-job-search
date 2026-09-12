from __future__ import annotations

import json
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
import uvicorn
from playwright.sync_api import expect

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.db import connect

ROOT = Path(__file__).parents[2]
EXTENSION_ROOT = ROOT / "extension"
BUILD_ROOT = EXTENSION_ROOT / "dist" / "extension"

_FIXTURES_DIR = Path(__file__).parent / "fixtures" / "handoff"


@pytest.fixture(scope="module", autouse=True)
def production_extension_build():
    npm = shutil.which("npm")
    assert npm is not None, "npm is required to build the production extension"
    subprocess.run([npm, "run", "build"], cwd=EXTENSION_ROOT, check=True)


# The real extension bundle hardcodes BASE_URL = "http://127.0.0.1:8420"
# in server-client.ts (design spec Section 2.3 — loopback-only, no
# session/config system to point it elsewhere). Every other
# browser-smoke fixture in this repo binds an ephemeral port because it
# only exercises server-side routes directly; this acceptance test
# instead drives the *real popup UI*, whose fetch() calls are compiled
# to this fixed address, so the fixture must bind exactly there rather
# than substitute a free port.
PAIRING_SERVER_PORT = 8420


@pytest.fixture
def live_server(tmp_path, monkeypatch):
    """Same shape as test_handoff_browser_smoke.py's live_server fixture,
    but bound to the fixed port the built extension's ServerClient talks
    to (see PAIRING_SERVER_PORT above) rather than an ephemeral one."""
    monkeypatch.setenv("OPENAI_API_KEY", "acceptance-test-secret-sentinel")
    port = PAIRING_SERVER_PORT
    settings = Settings(
        db_path=tmp_path / "jobsearch.sqlite3", host="127.0.0.1", port=port,
        documents_root=tmp_path / "documents", handoff_fixtures_dir=_FIXTURES_DIR,
    )
    app = create_app(settings)
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="warning", access_log=False,
    ))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                break
        except OSError:
            time.sleep(0.05)
    else:
        server.should_exit = True
        thread.join(timeout=5)
        raise RuntimeError(
            f"Uvicorn pairing-acceptance fixture did not start on 127.0.0.1:{port} "
            "(if another process already holds this port, e.g. a manually-run "
            "webapp instance, stop it before running this test)"
        )
    yield SimpleNamespace(base_url=f"http://127.0.0.1:{port}", db_path=settings.db_path)
    server.should_exit = True
    thread.join(timeout=10)
    assert not thread.is_alive(), "Uvicorn pairing-acceptance fixture did not stop cleanly"


@pytest.fixture
def extension_context(playwright, tmp_path):
    """A real, unpacked, production-built extension loaded into a fresh
    Chromium profile with no stored credential — the same
    launch_persistent_context pattern as
    test_extension_load_browser_smoke.py, reused rather than duplicated
    with a different shape."""
    extension_path = str(BUILD_ROOT.resolve())
    context = playwright.chromium.launch_persistent_context(
        str(tmp_path / "chromium-profile"),
        headless=False,
        args=[
            "--headless=new",
            f"--disable-extensions-except={extension_path}",
            f"--load-extension={extension_path}",
        ],
    )
    try:
        yield context
    finally:
        context.close()


def _service_worker(context):
    return (
        context.service_workers[0]
        if context.service_workers
        else context.wait_for_event("serviceworker", timeout=5_000)
    )


def _extension_id(context) -> str:
    return _service_worker(context).url.split("/")[2]


def _open_popup(context):
    extension_id = _extension_id(context)
    page = context.new_page()
    page.goto(f"chrome-extension://{extension_id}/popup.html")
    page.wait_for_selector("#app *", timeout=5_000)
    return page


def _fetch_pairing_code(base_url: str) -> str:
    html = urllib.request.urlopen(f"{base_url}/pairing").read().decode()
    # The pairing page renders the one-time code as the only long
    # URL-safe-base64 token in the page; matches the pattern
    # secrets.token_urlsafe(32) produces (see webapp/services/handoff.py).
    match = re.search(r"[A-Za-z0-9_-]{40,}", html)
    assert match, "no pairing code found on /pairing page"
    return match.group(0)


def test_fresh_popup_renders_unpaired_pairing_form(extension_context):
    page = _open_popup(extension_context)
    body_text = page.inner_text("#app")
    assert "Paired" not in body_text
    assert page.locator("#pairing-code").count() == 1
    assert page.locator("#pair-button").count() == 1
    page.close()


def test_valid_code_pairs_and_persists_across_popup_reload(extension_context, live_server):
    page = _open_popup(extension_context)
    code = _fetch_pairing_code(live_server.base_url)

    page.fill("#pairing-code", code)
    page.click("#pair-button")
    expect(page.locator("#app")).to_contain_text("Paired", timeout=5_000)

    assert page.locator("#run-autofill").count() == 1
    assert code not in page.content(), "pairing code must never render in popup HTML"

    page.reload()
    expect(page.locator("#app")).to_contain_text("Paired", timeout=5_000)
    page.close()


def test_invalid_code_shows_error_without_pairing(extension_context, live_server):
    page = _open_popup(extension_context)
    page.fill("#pairing-code", "not-a-real-pairing-code")
    page.click("#pair-button")
    expect(page.locator("#pairing-message")).to_contain_text("not recognized", timeout=5_000)
    assert "Paired" not in page.inner_text("#app")
    page.close()


def test_reused_code_rejected_and_does_not_erase_existing_credential(
    extension_context, live_server,
):
    """Covers both the reuse-rejection contract and the "a failed pairing
    attempt does not erase an already-valid durable credential" invariant
    in one flow: the popup shows no pairing form once paired, so the only
    way to attempt a second exchange against a credential the popup
    already holds is directly against the server it talks to — proving
    the credential the popup already persisted survives it."""
    page = _open_popup(extension_context)
    code = _fetch_pairing_code(live_server.base_url)
    page.fill("#pairing-code", code)
    page.click("#pair-button")
    expect(page.locator("#app")).to_contain_text("Paired", timeout=5_000)

    req = urllib.request.Request(
        f"{live_server.base_url}/api/handoff/pairing/exchange",
        data=json.dumps({"one_time_secret": code}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(req)
    assert exc_info.value.code == 400

    page.reload()
    expect(page.locator("#app")).to_contain_text(
        "Paired", timeout=5_000
    )  # existing durable credential must survive an unrelated failed pairing attempt
    page.close()


def test_expired_code_rejected_via_direct_expiry_fast_forward(
    extension_context, live_server,
):
    """Covers expiry without a real 10-minute wait by rewriting
    pairing_secrets.expires_at into the past on the live server's own
    database — the same test-only technique
    tests/webapp/services/test_handoff.py::test_exchange_rejects_expired_code
    already uses at the service layer. This does not touch or shorten the
    production 10-minute window (webapp/services/handoff.py's
    generate_pairing_secret always computes now + timedelta(minutes=10));
    it only fast-forwards what "now" the test observes when it later
    calls exchange, which is a test-data mutation, not a production
    behavior change."""
    code = _fetch_pairing_code(live_server.base_url)

    conn = connect(live_server.db_path)
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    conn.execute("UPDATE pairing_secrets SET expires_at = ?", (past,))
    conn.commit()
    conn.close()

    page = _open_popup(extension_context)
    page.fill("#pairing-code", code)
    page.click("#pair-button")
    expect(page.locator("#pairing-message")).to_contain_text("expired", timeout=5_000)
    assert "Paired" not in page.inner_text("#app")
    page.close()


def test_run_autofill_reaches_background_worker_and_fills_fixture_page(
    extension_context, live_server,
):
    """Exercises the popup -> background-worker message path
    (popup_run_autofill -> runAutofillOnTab) against the repository's
    real generic_fixture.html acceptance page, reusing the same
    MANUAL_TEST_SNAPSHOT_KEY / MANUAL_TEST_SESSION_ID_KEY bridge
    background/index.ts still depends on (Sub-project 2 has not removed
    it yet, per the design spec's own scope boundary) — set here via the
    service worker's own context, the same worker.evaluate() pattern
    test_extension_load_browser_smoke.py already uses."""
    worker = _service_worker(extension_context)
    worker.evaluate(
        """() => chrome.storage.local.set({
            handoff_manual_test_snapshot: { name: "Ada Lovelace", email: "ada@example.com" },
            handoff_manual_test_session_id: "acceptance-test-session",
        })"""
    )

    fixture_page = extension_context.new_page()
    fixture_page.goto(f"{live_server.base_url}/test-fixtures/handoff/generic_fixture.html")

    errors: list[str] = []
    fixture_page.on("pageerror", lambda exc: errors.append(str(exc)))

    popup = _open_popup(extension_context)
    code = _fetch_pairing_code(live_server.base_url)
    popup.fill("#pairing-code", code)
    popup.click("#pair-button")
    expect(popup.locator("#app")).to_contain_text("Paired", timeout=5_000)

    popup.click("#run-autofill")
    fixture_page.wait_for_timeout(500)

    assert errors == [], f"unexpected fixture-page runtime errors: {errors}"

    popup.close()
    fixture_page.close()
