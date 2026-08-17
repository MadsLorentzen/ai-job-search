import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live portal tests hit the real job board over the network. CI deliberately
// does not run them (see .github/workflows/ci.yml): they are network-flaky and
// job boards block datacenter IPs, so a red build would mean "GitHub's runner
// was blocked today", not "this CLI is broken". Run them locally on demand:
//   LIVE_PORTAL_TESTS=1 bun test
const LIVE_PORTAL_TESTS = process.env.LIVE_PORTAL_TESTS === "1"


interface SearchResult {
  meta: { count: number; page: number };
  results: Array<{
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    date: string | null;
    url: string;
  }>;
}

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("Randstad India CLI — flag validation", () => {
  test("no --query and no --location exits 1 with NO_CRITERIA", async () => {
    const result = await runCLI(["search"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("NO_CRITERIA");
  });

  test("--jobage non-numeric exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", "manager", "--jobage", "foo"]);
    expect(result.exitCode).not.toBe(0);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toMatch(/jobage/);
  });

  test("detail without an argument exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  test("detail with a non-URL exits 1 with BAD_ID", async () => {
    const result = await runCLI(["detail", "not-a-url"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
  });

  test("unknown command exits 1 with BAD_CMD", async () => {
    const result = await runCLI(["frobnicate"]);
    expect(result.exitCode).not.toBe(0);
    expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
  });
});

describe.skipIf(!LIVE_PORTAL_TESTS)("Randstad India CLI — live search", () => {
  test("search returns >=1 result with non-null id/title/url", async () => {
    const result = await runCLI([
      "search",
      "-q",
      "project manager",
      "-l",
      "Pune",
      "--limit",
      "5",
    ]);
    expect(result.exitCode).toBe(0);
    const data = parseJSON<SearchResult>(result);
    expect(data.results.length).toBeGreaterThan(0);
    const first = data.results[0];
    expect(first.id).toBeTruthy();
    expect(first.title).toBeTruthy();
    expect(first.url).toContain("randstad.in/jobs/");
  }, 30000);
});
