import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Every case here is offline: `list` reads the registry only, and the `search`
// and `detail` cases all fail argument or registry validation before any fetch.
//
// The registry itself is not fixed: company_pages.json is personal and gitignored,
// so CI reads the committed example while a developer's checkout may not. Cases
// that depend on the example's contents guard on `usingExampleRegistry` rather
// than assuming it.

const usingExampleRegistry = (stderr: string): boolean =>
  stderr.includes("USING_EXAMPLE_REGISTRY");

interface ListEntry {
  name: string;
  ats: string;
  ats_id: string;
  careers_url: string;
}

describe("help and unknown commands", () => {
  test("no command prints help and exits 1", async () => {
    const r = await runCLI([]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("USAGE");
  });

  test("--help on a command exits 0", async () => {
    const r = await runCLI(["list", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("USAGE");
  });

  test("an unknown command exits 1 with a machine-readable code", async () => {
    const r = await runCLI(["frobnicate"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr.split("\n").pop()!).code).toBe("BAD_CMD");
  });
});

describe("list", () => {
  test("emits the registry as JSON", async () => {
    const r = await runCLI(["list"]);
    const out = parseJSON<{ results?: ListEntry[] } | ListEntry[]>(r);
    const entries = Array.isArray(out) ? out : (out.results ?? []);
    expect(entries.length).toBeGreaterThan(0);
  });

  test("warns on stderr when falling back to the example registry", async () => {
    const r = await runCLI(["list"]);
    // The personal registry is gitignored, so CI always takes the fallback.
    // If a developer has one locally, there is simply no warning to assert.
    if (r.stderr) {
      expect(r.stderr).toContain("USING_EXAMPLE_REGISTRY");
    }
    expect(r.exitCode).toBe(0);
  });

  test("every registry entry declares a known ats type", async () => {
    const r = await runCLI(["list"]);
    const out = parseJSON<{ results?: ListEntry[] } | ListEntry[]>(r);
    const entries = Array.isArray(out) ? out : (out.results ?? []);
    const known = ["greenhouse", "lever", "smartrecruiters", "oracle", "generic"];
    for (const e of entries) expect(known).toContain(e.ats);
  });

  test("the example registry demonstrates every supported ats type", async () => {
    const r = await runCLI(["list"]);
    // Only assert this against the shipped example. A developer with a personal
    // company_pages.json is under no obligation to cover every ats type.
    if (!usingExampleRegistry(r.stderr)) return;
    const out = parseJSON<{ results?: ListEntry[] } | ListEntry[]>(r);
    const entries = Array.isArray(out) ? out : (out.results ?? []);
    const seen = new Set(entries.map((e) => e.ats));
    for (const t of ["greenhouse", "lever", "smartrecruiters", "oracle", "generic"]) {
      expect(seen.has(t)).toBe(true);
    }
  });

  test("table format renders a header rather than JSON", async () => {
    const r = await runCLI(["list", "--format", "table"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.startsWith("{")).toBe(false);
  });

  test("an unrecognised format falls back to json instead of erroring", async () => {
    const r = await runCLI(["list", "--format", "yaml"]);
    expect(r.exitCode).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});

describe("search argument validation", () => {
  test("a non-numeric --limit is rejected before any network call", async () => {
    const r = await runCLI(["search", "--limit", "many"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr.split("\n").pop()!).code).toBe("BAD_ARG");
  });

  test("an unknown company is rejected before any network call", async () => {
    const r = await runCLI(["search", "--company", "No Such Company AG"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr.split("\n").pop()!).code).toBe("COMPANY_NOT_FOUND");
  });

  test("-c is an alias for --company", async () => {
    const r = await runCLI(["search", "-c", "No Such Company AG"]);
    expect(JSON.parse(r.stderr.split("\n").pop()!).code).toBe("COMPANY_NOT_FOUND");
  });
});

describe("detail argument validation", () => {
  test("missing --company and --id exits 1", async () => {
    const r = await runCLI(["detail"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr.split("\n").pop()!).code).toBe("NO_ARGS");
  });

  test("--company without --id exits 1", async () => {
    const r = await runCLI(["detail", "--company", "Stripe"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr.split("\n").pop()!).code).toBe("NO_ARGS");
  });

  test("an unknown company is reported, not silently fetched", async () => {
    const r = await runCLI(["detail", "--company", "No Such Company AG", "--id", "1"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr.split("\n").pop()!).code).toBe("COMPANY_NOT_FOUND");
  });

  test("ats=generic has no detail API and says so", async () => {
    const list = await runCLI(["list"]);
    const out = parseJSON<{ results?: ListEntry[] } | ListEntry[]>(list);
    const entries = Array.isArray(out) ? out : (out.results ?? []);
    const generic = entries.find((e) => e.ats === "generic");
    if (!generic) return; // a personal registry need not contain a generic entry
    const r = await runCLI(["detail", "--company", generic.name, "--id", "1"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr.split("\n").pop()!).code).toBe("NO_DETAIL_API");
  });
});
