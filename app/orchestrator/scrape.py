from __future__ import annotations

import sys
import time
from typing import Any

print("[HiringCafe] MODULE LOADING...", flush=True)

try:
    from playwright.sync_api import sync_playwright
    print("[HiringCafe] Playwright imported successfully.", flush=True)
except Exception as exc:
    print(f"[HiringCafe] FAILED TO IMPORT PLAYWRIGHT: {exc}", flush=True)
    raise


HIRING_CAFE_URL = "https://hiring.cafe/"


def fetch_hiring_cafe_jobs(
    query: str,
    location: str = "Remote",
    limit: int = 10,
) -> list[dict[str, Any]]:

    print(
        f"[HiringCafe] FUNCTION STARTED | "
        f"query={query!r} | location={location!r} | limit={limit}",
        flush=True,
    )

    if limit <= 0:
        print("[HiringCafe] Limit <= 0. Returning.", flush=True)
        return []

    print("[HiringCafe] Creating Playwright...", flush=True)

    try:
        with sync_playwright() as playwright:

            print(
                "[HiringCafe] Playwright started.",
                flush=True,
            )

            print(
                "[HiringCafe] Launching Chromium...",
                flush=True,
            )

            browser = playwright.chromium.launch(
                headless=False,
                timeout=15000,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                ],
            )

            print(
                "[HiringCafe] Chromium launched.",
                flush=True,
            )

            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                viewport={
                    "width": 1440,
                    "height": 900,
                },
                locale="en-US",
            )

            print(
                "[HiringCafe] Browser context created.",
                flush=True,
            )

            page = context.new_page()

            print(
                "[HiringCafe] Page created.",
                flush=True,
            )

            page.set_default_timeout(15000)
            page.set_default_navigation_timeout(20000)

            # ---------------------------------------------------------
            # Network diagnostics
            # ---------------------------------------------------------

            def handle_response(response):
                url = response.url

                if (
                    "hiring.cafe" in url
                    and (
                        "_next" in url
                        or "api" in url
                        or "search" in url
                    )
                ):
                    print(
                        f"[HiringCafe][RESPONSE] "
                        f"{response.status} {url}",
                        flush=True,
                    )

            page.on("response", handle_response)

            page.on(
                "requestfailed",
                lambda request: print(
                    f"[HiringCafe][REQUEST FAILED] "
                    f"{request.url} | "
                    f"{request.failure}",
                    flush=True,
                ),
            )

            # ---------------------------------------------------------
            # Open homepage first
            # ---------------------------------------------------------

            print(
                f"[HiringCafe] Navigating to {HIRING_CAFE_URL}",
                flush=True,
            )

            start = time.time()

            response = page.goto(
                HIRING_CAFE_URL,
                wait_until="domcontentloaded",
                timeout=20000,
            )

            elapsed = time.time() - start

            print(
                f"[HiringCafe] Homepage navigation finished "
                f"in {elapsed:.2f}s",
                flush=True,
            )

            if response:
                print(
                    f"[HiringCafe] HTTP status: "
                    f"{response.status}",
                    flush=True,
                )

            print(
                f"[HiringCafe] Current URL: {page.url}",
                flush=True,
            )

            print(
                f"[HiringCafe] Page title: {page.title()}",
                flush=True,
            )

            # ---------------------------------------------------------
            # Check visible page content
            # ---------------------------------------------------------

            body_text = page.locator("body").inner_text(
                timeout=10000
            )

            print(
                "[HiringCafe] Page body loaded.",
                flush=True,
            )

            print(
                "[HiringCafe] First 500 characters:",
                flush=True,
            )

            print(
                body_text[:500],
                flush=True,
            )

            # ---------------------------------------------------------
            # Keep browser open temporarily
            # ---------------------------------------------------------

            print(
                "\n[HiringCafe] Browser is open.",
                flush=True,
            )

            print(
                "[HiringCafe] Inspect the browser window.",
                flush=True,
            )

            print(
                "[HiringCafe] Waiting 5 seconds...",
                flush=True,
            )

            page.wait_for_timeout(5000)

            # ---------------------------------------------------------
            # Finish
            # ---------------------------------------------------------

            print(
                "[HiringCafe] Closing browser...",
                flush=True,
            )

            context.close()
            browser.close()

            print(
                "[HiringCafe] Diagnostic completed.",
                flush=True,
            )

            return []

    except Exception as exc:

        print(
            "\n[HiringCafe] !!! EXCEPTION !!!",
            flush=True,
        )

        print(
            f"Type: {type(exc).__name__}",
            flush=True,
        )

        print(
            f"Message: {exc}",
            flush=True,
        )

        print(
            "Python executable:",
            sys.executable,
            flush=True,
        )

        return []


if __name__ == "__main__":
    print(
        "[HiringCafe] Running direct diagnostic...",
        flush=True,
    )

    jobs = fetch_hiring_cafe_jobs(
        query="Data Engineer Snowflake",
        location="Remote",
        limit=10,
    )

    print(
        f"[HiringCafe] Returned {len(jobs)} jobs.",
        flush=True,
    )