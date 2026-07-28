import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// Every case here is rejected before any request is made, so the suite is
// network-free and safe to run in CI. A dummy key is injected where the command
// would otherwise short-circuit on NO_API_KEY, and cleared where that is the
// behaviour under test - so the results do not depend on the developer's shell.
// FIRECRAWL_API_URL is pinned empty so an instance configured in the developer's
// shell cannot change which code path these cases take.
const KEY = { FIRECRAWL_API_KEY: "fc-test-key", FIRECRAWL_API_URL: "" };

function stderrJSON(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr);
}

describe("CLI argument validation", () => {
  test("search without --query exits 1 with NO_QUERY on stderr", async () => {
    const result = await runCLI(["search"], KEY);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(stderrJSON(result.stderr).code).toBe("NO_QUERY");
  });

  test("--site and --exclude-site together exit 1 with BAD_ARG", async () => {
    // The API rejects both filters in one request; catching it locally gives a
    // clearer message and spends no credits.
    const result = await runCLI(["search", "-q", "data engineer", "--site", "a.com", "--exclude-site", "b.com"], KEY);
    expect(result.exitCode).toBe(1);
    expect(stderrJSON(result.stderr).code).toBe("BAD_ARG");
  });

  test("a non-numeric --jobage exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", "data engineer", "--jobage", "recently"], KEY);
    expect(result.exitCode).toBe(1);
    expect(stderrJSON(result.stderr).code).toBe("BAD_ARG");
  });

  test("a page window beyond Firecrawl's 100-result cap exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", "data engineer", "--page", "20", "--limit", "10"], KEY);
    expect(result.exitCode).toBe(1);
    const parsed = stderrJSON(result.stderr);
    expect(parsed.code).toBe("BAD_ARG");
    expect(parsed.error).toContain("100");
  });

  test("detail without a URL exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"], KEY);
    expect(result.exitCode).toBe(1);
    expect(stderrJSON(result.stderr).code).toBe("NO_ID");
  });

  test("detail with an unparseable id exits 1 with BAD_ID", async () => {
    const result = await runCLI(["detail", "not-a-url"], KEY);
    expect(result.exitCode).toBe(1);
    expect(stderrJSON(result.stderr).code).toBe("BAD_ID");
  });

  test("an unknown command exits 1 with BAD_CMD", async () => {
    const result = await runCLI(["crawl"], KEY);
    expect(result.exitCode).toBe(1);
    expect(stderrJSON(result.stderr).code).toBe("BAD_CMD");
  });

  test("a missing API key exits 1 with NO_API_KEY and names the variable", async () => {
    const result = await runCLI(["search", "-q", "data engineer"], {
      FIRECRAWL_API_KEY: "",
      FIRECRAWL_API_URL: "",
    });
    expect(result.exitCode).toBe(1);
    const parsed = stderrJSON(result.stderr);
    expect(parsed.code).toBe("NO_API_KEY");
    expect(parsed.error).toContain("FIRECRAWL_API_KEY");
  });

  test("a keyless self-hosted instance is not rejected as NO_API_KEY", async () => {
    // Self-hosted Firecrawl defaults to authentication disabled, so pointing
    // FIRECRAWL_API_URL at one must reach the request rather than fail up front.
    // Nothing listens on this port, so it fails at connect - which is the point:
    // the error is a connection failure, not a missing credential.
    const result = await runCLI(["search", "-q", "data engineer"], {
      FIRECRAWL_API_KEY: "",
      FIRECRAWL_API_URL: "http://127.0.0.1:9",
    });
    expect(result.exitCode).toBe(1);
    const parsed = stderrJSON(result.stderr);
    expect(parsed.code).toBe("SEARCH_FAILED");
    expect(parsed.error).toContain("could not reach the Firecrawl API");
  });

  test("no arguments prints help to stdout and exits 1", async () => {
    const result = await runCLI([], KEY);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("USAGE");
    expect(result.stderr).toBe("");
  });

  test("--help on a command prints help and exits 0", async () => {
    const result = await runCLI(["search", "--help"], KEY);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SEARCH FLAGS");
  });
});
