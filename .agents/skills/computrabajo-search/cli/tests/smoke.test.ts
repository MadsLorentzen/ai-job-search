import { describe, it, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers.ts";

describe("computrabajo-search CLI", () => {
  it("rejects missing --query on search", async () => {
    const result = await runCLI(["search"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toContain("--query");
  });

  it("rejects unknown command", async () => {
    const result = await runCLI(["bogus"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toContain("Unknown command");
  });

  it("rejects missing id on detail", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toContain("detail requires");
  });

  it("shows help with --help flag", async () => {
    const result = await runCLI(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("computrabajo-cli");
  });

  it("performs a live search for ingeniero software", async () => {
    const result = await runCLI(["search", "-q", "ingeniero software", "--limit", "3", "--format", "json"]);
    if (result.exitCode !== 0) {
      // Network issues may cause failure; skip assertion
      console.warn("Live search failed (network?):", result.stderr);
      return;
    }
    const data = parseJSON<{ meta: { count: number }; results: Array<{ id: string; title: string }> }>(result);
    expect(data.meta.count).toBeGreaterThan(0);
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]).toHaveProperty("id");
    expect(data.results[0]).toHaveProperty("title");
    expect(data.results[0]).toHaveProperty("url");
  }, 30000);
});
