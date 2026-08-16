import { describe, test, expect, beforeAll } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

// Pull a fresh, currently-live job id from Foundit's (robots-allowed)
// today's-jobs sitemap so the live test does not rot as postings expire.
async function firstLiveJobId(): Promise<string> {
  const res = await fetch(
    "https://www.foundit.in/xmlsitemap/todays-jobs-sitemap.xml",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    },
  );
  const xml = await res.text();
  const m = xml.match(/<loc>https:\/\/www\.foundit\.in\/job\/[^<]*?-(\d{5,})<\/loc>/i);
  if (!m) throw new Error("no job id found in sitemap");
  return m[1];
}

describe("foundit CLI — detail (live)", () => {
  let jobId = "";
  beforeAll(async () => {
    jobId = await firstLiveJobId();
  });

  test("detail returns a populated posting", async () => {
    const result = await runCLI(["detail", jobId, "--format", "json"]);
    const job = parseJSON<{
      id: string;
      title: string;
      url: string;
      company: string | null;
    }>(result);
    expect(job.id).toBeTruthy();
    expect(job.title).toBeTruthy();
    expect(job.title).not.toBe("(untitled)");
    expect(job.url).toContain("foundit.in/job/");
  });

  test("detail accepts a full job URL", async () => {
    const url = `https://www.foundit.in/job/${jobId}`;
    const result = await runCLI(["detail", url]);
    expect(result.exitCode).toBe(0);
  });
});

describe("foundit CLI — error paths", () => {
  test("missing id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  test("unparseable id exits 1 with BAD_ID", async () => {
    const result = await runCLI(["detail", "not-a-job"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
  });

  test("bogus numeric id exits 1 with NOT_FOUND", async () => {
    const result = await runCLI(["detail", "99999999999"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("NOT_FOUND");
  });

  test("search command exits 1 with SEARCH_UNSUPPORTED", async () => {
    const result = await runCLI(["search", "-q", "data analyst"]);
    expect(result.exitCode).toBe(1);
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("SEARCH_UNSUPPORTED");
    expect(err.error).toMatch(/robots\.txt|detail/i);
  });

  test("unknown command exits 1 with BAD_CMD", async () => {
    const result = await runCLI(["frobnicate"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
  });
});
