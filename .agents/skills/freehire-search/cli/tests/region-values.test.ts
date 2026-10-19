import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// `regions` is a closed vocabulary of macro-region buckets, not a geography, so
// `--region us` is a country asked of a bucket flag. The API filters on the raw
// index tags and still exits 0, which reads as "no postings" rather than "wrong
// parameter". An unknown value is a BAD_ARG before any request (#616), the same
// way `--remote` rejects a bad work_mode.

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

async function searchRegion(args: string[]): Promise<{ result: Awaited<ReturnType<typeof runCLI>>; requests: URL[] }> {
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url));
      return Response.json({ data: [], meta: { total: 0 } });
    },
  });
  try {
    const result = await runCLI(["search", "-q", "go", "--limit", "1", ...args], {
      FREEHIRE_API_URL: server.url.toString(),
    });
    return { result, requests };
  } finally {
    server.stop(true);
  }
}

describe("--region bucket validation", () => {
  test("--region us exits 1 with BAD_ARG and does not call the API", async () => {
    const { result, requests } = await searchRegion(["--region", "us"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("BAD_ARG");
    expect(err.error).toContain("--region");
    expect(err.error).toContain("us");
    expect(err.error).toContain("--country");
    expect(requests).toEqual([]);
  });

  test("a comma-separated list is split and only its unknown values are named", async () => {
    const { result, requests } = await searchRegion(["--region", "eu,russia"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    expect(parsedStderr(result.stderr).error).toContain("russia");
    expect(requests).toEqual([]);
  });

  test("every documented bucket reaches the API as a regions param", async () => {
    for (const value of [
      "global",
      "north_america",
      "latam",
      "eu",
      "uk",
      "mena",
      "africa",
      "apac",
      "cis",
      "none",
    ]) {
      const { result, requests } = await searchRegion(["--region", value]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(requests).toHaveLength(1);
      expect(requests[0].searchParams.getAll("regions")).toEqual([value]);
    }
  });

  test("a comma list ORs as repeated regions params", async () => {
    const { result, requests } = await searchRegion(["--region", "eu,none"]);
    expect(result.exitCode).toBe(0);
    expect(requests[0].searchParams.getAll("regions")).toEqual(["eu", "none"]);
  });

  test("case and padding are normalized rather than forwarded verbatim", async () => {
    const { result, requests } = await searchRegion(["--region", "EU, north_america"]);
    expect(result.exitCode).toBe(0);
    expect(requests[0].searchParams.getAll("regions")).toEqual(["eu", "north_america"]);
  });

  test("--region unset issues no regions param", async () => {
    const { result, requests } = await searchRegion([]);
    expect(result.exitCode).toBe(0);
    expect(requests[0].searchParams.getAll("regions")).toEqual([]);
  });
});
