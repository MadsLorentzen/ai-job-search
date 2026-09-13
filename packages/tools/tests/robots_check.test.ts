/**
 * Offline tests for robots_check — no network: every case exercises the
 * parser against literal robots.txt bodies (or a stubbed fetch), matching
 * the repo's CI policy of making no live portal requests.
 *
 * The cases marked FAIL-OPEN REGRESSION are the ones Python's own
 * urllib.robotparser gets wrong. They are pinned here because getting them
 * wrong means the browser-header retry runs against a site that said no,
 * which is the exact boundary this tool exists to hold.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  allowed,
  BROWSER,
  gate,
  isRobotsBody,
  robotsCheckMain,
  type Fetcher,
} from "../src/robots_check.ts";

// Real body served by privatebank.barclays.com: blank lines sit between the
// User-agent line and its rules. Python's robotparser treats those as record
// separators and drops every rule, so /cs/ reads as allowed.
const BARCLAYS =
  "User-agent: *\n\n\nAllow: /\n\nDisallow: /cs/\n\nSitemap: https://x/sitemap.xml\n";

// jobup.ch: the case a community fork was asked to ship opt-in.
const JOBUP = "User-agent: *\nDisallow: /api/\n";

describe("path rules", () => {
  test("blank lines inside record do not end it", () => {
    // FAIL-OPEN REGRESSION: /cs/ is disallowed despite the blank lines.
    expect(allowed(BARCLAYS, "*", "/cs/")).toBe(false);
  });

  test("allowed path on same site still allowed", () => {
    expect(allowed(BARCLAYS, "*", "/careers/")).toBe(true);
  });

  test("longest match wins over rule order", () => {
    // FAIL-OPEN REGRESSION: 'Allow: /' precedes 'Disallow: /cs/' in the
    // file; specificity must win, not position.
    const body = "User-agent: *\nAllow: /\nDisallow: /cs/\n";
    expect(allowed(body, "*", "/cs/deep/page")).toBe(false);
  });

  test("longest match can unblock", () => {
    const body = "User-agent: *\nDisallow: /\nAllow: /jobs/\n";
    expect(allowed(body, "*", "/jobs/x")).toBe(true);
    expect(allowed(body, "*", "/other")).toBe(false);
  });

  test("equal specificity tie goes to disallow", () => {
    // Cautious tie-break: Google resolves ties to Allow, we do not.
    expect(allowed("User-agent: *\nDisallow: /a\nAllow: /a\n", "*", "/a")).toBe(false);
  });

  test("equal specificity tie goes to disallow when allow listed first", () => {
    // The only ordering that exercises the tie-break clause: with Allow
    // first, deleting the clause makes the first rule at a given length win
    // and Allow would leak through (review finding F21, 2026-08-19).
    expect(allowed("User-agent: *\nAllow: /a\nDisallow: /a\n", "*", "/a")).toBe(false);
  });

  test("api block and sibling path", () => {
    expect(allowed(JOBUP, "*", "/api/v1/public/search")).toBe(false);
    expect(allowed(JOBUP, "*", "/en/jobs/")).toBe(true);
  });

  test("wildcard and end anchor", () => {
    const body = "User-agent: *\nDisallow: /*.pdf$\n";
    expect(allowed(body, "*", "/files/cv.pdf")).toBe(false);
    expect(allowed(body, "*", "/files/cv.pdf.html")).toBe(true);
  });

  test("empty disallow means allow everything", () => {
    expect(allowed("User-agent: *\nDisallow:\n", "*", "/anything")).toBe(true);
  });

  test("empty or ruleless robots allows", () => {
    expect(allowed("", "*", "/x")).toBe(true);
    expect(allowed("# just a comment\n", "*", "/x")).toBe(true);
  });

  test("comments are stripped", () => {
    expect(allowed("User-agent: *\nDisallow: /x  # nope\n", "*", "/x")).toBe(false);
  });
});

describe("agent selection", () => {
  test("named Claude-User opt-out is honored", () => {
    const body = "User-agent: Claude-User\nDisallow: /\n\nUser-agent: *\nAllow: /\n";
    expect(allowed(body, "Claude-User", "/a")).toBe(false);
    expect(allowed(body, "*", "/a")).toBe(true);
  });

  test("agent match is case-insensitive", () => {
    const body = "User-agent: CLAUDE-USER\nDisallow: /x\n";
    expect(allowed(body, "claude-user", "/x")).toBe(false);
  });

  test("falls back to star when agent absent", () => {
    expect(allowed(JOBUP, "Claude-User", "/api/v1")).toBe(false);
  });

  test("multiple agents share one ruleset", () => {
    const body = "User-agent: A\nUser-agent: Claude-User\nDisallow: /z\n";
    expect(allowed(body, "Claude-User", "/z")).toBe(false);
    expect(allowed(body, "A", "/z")).toBe(false);
  });
});

describe("CLI entry point", () => {
  test("no URL argument fails loudly rather than defaulting to allowed", () => {
    expect(robotsCheckMain([])).not.toBe(0);
  });

  test("a dash-leading argument fails closed", () => {
    expect(robotsCheckMain(["--help"])).toBe(1);
  });

  test("curl argv ends with a double dash before the url", () => {
    const src = readFileSync(new URL("../src/robots_check.ts", import.meta.url), "utf8");
    expect(src).toContain('"--",\n      url,');
  });
});

describe("soft 200", () => {
  // A 200 whose body is not a robots.txt used to grant permission: zero
  // rules read as "allowed", so the browser retry ran on permission that
  // was never given. FAIL-OPEN REGRESSION.
  test("html error page is not a robots file", () => {
    expect(isRobotsBody("<html><body>404 Not Found</body></html>")).toBe(false);
  });

  test("json error body is not a robots file", () => {
    expect(isRobotsBody('{"error":"not found"}')).toBe(false);
  });

  test("soft 200 is unconfirmed, not allowed", () => {
    const stub: Fetcher = () => ["<html>404</html>", 200];
    const [rc, msg] = gate("https://x.example/jobs", stub);
    expect(rc).toBe(1);
    expect(msg).toContain("not a robots.txt");
  });

  test("gate reads policy as browser when honest request is refused", () => {
    // 09-web-research.md's Barclays-class recovery: the policy file itself
    // returns 403 to Claude-User and 200 to a browser (review finding F30).
    const waf: Fetcher = (_url, ua) =>
      ua === BROWSER ? ["User-agent: *\nAllow: /\n", 200] : ["<html>403 Forbidden</html>", 403];
    const [rc, msg] = gate("https://waf.example/jobs", waf);
    expect(rc).toBe(0);
    expect(msg).toContain("ALLOWED");
  });

  test("gate obeys a browser-fetched policy strictly", () => {
    // The fallback must not fail open: a policy readable only as a browser
    // still disallows what it disallows.
    const waf: Fetcher = (_url, ua) =>
      ua === BROWSER
        ? ["User-agent: *\nDisallow: /jobs\n", 200]
        : ["<html>403 Forbidden</html>", 403];
    const [rc, msg] = gate("https://waf.example/jobs", waf);
    expect(rc).toBe(1);
    expect(msg).toContain("DISALLOWED");
  });

  test("a genuinely empty robots is still allow-all", () => {
    // RFC 9309: an empty file permits everything. Do not over-correct.
    expect(isRobotsBody("")).toBe(true);
    expect(isRobotsBody("\n\n   \n")).toBe(true);
  });

  test("a real policy is recognised", () => {
    expect(isRobotsBody(BARCLAYS)).toBe(true);
    expect(isRobotsBody(JOBUP)).toBe(true);
  });

  test("sitemap-only file counts", () => {
    expect(isRobotsBody("Sitemap: https://x.example/sitemap.xml\n")).toBe(true);
  });
});

describe("percent-encoded rules", () => {
  // Rule patterns are percent-decoded to match the decoded request path.
  // FAIL-OPEN REGRESSION: without this, a site that percent-encodes its own
  // Disallow patterns has them silently skipped.
  test("encoded space in disallow now matches", () => {
    expect(allowed("User-agent: *\nDisallow: /foo%20bar\n", "*", "/foo bar")).toBe(false);
  });

  test("encoded rule does not overmatch", () => {
    expect(allowed("User-agent: *\nDisallow: /foo%20bar\n", "*", "/foobar")).toBe(true);
  });

  test("plain rules are unaffected", () => {
    expect(allowed(JOBUP, "*", "/api/x")).toBe(false);
    expect(allowed(JOBUP, "*", "/en/jobs/x")).toBe(true);
  });
});

describe("argument hardening", () => {
  // A URL can never be read by curl as an option. gate() rebuilds the
  // target as scheme://host/robots.txt, so the gate path was never exposed;
  // these pin the rebuild itself.
  test("gate never passes the caller url through to curl", () => {
    const seen: string[] = [];
    const spy: Fetcher = (url) => {
      seen.push(url);
      return ["User-agent: *\nAllow: /\n", 200];
    };
    gate("https://x.example/-o/evil?q=1", spy);
    expect(seen[0]).toBe("https://x.example/robots.txt");
  });
});
