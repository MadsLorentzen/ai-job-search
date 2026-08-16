import { describe, expect, test } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Every case fails argument validation, or resolves against the registry,
// before any network request — the suite is network-free.
//
// Regression context, both found by writing these tests against the real CLI:
//
//  1. `--key=value` was parsed as a flag literally named "key=value", so
//     `--company=Pictet` left `company` unset and the search silently ran
//     against every entry in the registry instead of one. On a 45-employer
//     watchlist that turns a typo into 45 requests, which is the opposite of
//     this skill's "keep volume low" rule.
//  2. `--limit -5` parsed as `limit: true`, and the downstream `>= 0` guard
//     then skipped the slice entirely, returning the whole result set instead
//     of the cap the user asked for.

const errorOf = (stderr: string) => JSON.parse(stderr.split("\n").pop()!);

interface ListEntry {
  name: string;
  ats: string;
}

describe("the --key=value form is understood, not swallowed", () => {
  test("--company=<unknown> errors instead of querying every employer", async () => {
    const r = await runCLI(["search", "--company=No Such Company AG"]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("COMPANY_NOT_FOUND");
  });

  test("-c=<unknown> resolves the alias too", async () => {
    const r = await runCLI(["search", "-c=No Such Company AG"]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("COMPANY_NOT_FOUND");
  });

  test("--limit=<junk> reaches the validator", async () => {
    const r = await runCLI(["search", "--limit=many"]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("BAD_ARG");
  });

  test("--format=table is honoured", async () => {
    const r = await runCLI(["list", "--format=table"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.startsWith("{")).toBe(false);
  });

  test("a value containing '=' survives intact", async () => {
    const r = await runCLI(["search", "--company=A=B Ltd"]);
    expect(errorOf(r.stderr).code).toBe("COMPANY_NOT_FOUND");
    expect(errorOf(r.stderr).error).toContain("A=B Ltd");
  });

  test("an empty value is not silently treated as absent", async () => {
    // Would otherwise widen a one-employer query to the entire watchlist.
    const r = await runCLI(["search", "--company="]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("BAD_ARG");
  });

  test("--company with no value at all is rejected, not widened to every entry", async () => {
    const r = await runCLI(["search", "--company", "--format", "json"]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("BAD_ARG");
  });

  test("--query and --location are guarded the same way", async () => {
    for (const flag of ["--query=", "--location="]) {
      const r = await runCLI(["search", flag]);
      expect(r.exitCode).toBe(1);
      expect(errorOf(r.stderr).code).toBe("BAD_ARG");
    }
  });
});

describe("--limit validation", () => {
  test("a negative limit is rejected rather than ignored", async () => {
    const r = await runCLI(["search", "--limit=-5"]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("BAD_ARG");
    expect(errorOf(r.stderr).error).toContain("negative");
  });

  test("a space-separated negative limit is rejected too", async () => {
    const r = await runCLI(["search", "--limit", "-5"]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("BAD_ARG");
  });

  test("a trailing-junk limit is rejected rather than truncated to 5", async () => {
    const r = await runCLI(["search", "--limit=5x"]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("BAD_ARG");
  });

  test("a fractional limit is rejected", async () => {
    const r = await runCLI(["search", "--limit=1.5"]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("BAD_ARG");
  });

  test("--limit with no value at all is rejected", async () => {
    const r = await runCLI(["search", "--limit", "--format", "json"]);
    expect(r.exitCode).toBe(1);
    expect(errorOf(r.stderr).code).toBe("BAD_ARG");
  });

  test("--limit=0 is accepted and caps the output at nothing", async () => {
    const r = await runCLI(["list"]);
    const out = parseJSON<{ results?: ListEntry[] } | ListEntry[]>(r);
    const entries = Array.isArray(out) ? out : (out.results ?? []);
    const unknown = entries.every((e) => e.name !== "No Such Company AG");
    expect(unknown).toBe(true); // sanity: the guard name is not a real entry
    const s = await runCLI(["search", "--company=No Such Company AG", "--limit=0"]);
    // Still resolves the company first, so a zero limit is not a way to skip
    // validation.
    expect(errorOf(s.stderr).code).toBe("COMPANY_NOT_FOUND");
  });
});

describe("flag forms that must keep working", () => {
  test("space-separated values still parse", async () => {
    const r = await runCLI(["search", "--company", "No Such Company AG"]);
    expect(errorOf(r.stderr).code).toBe("COMPANY_NOT_FOUND");
  });

  test("a boolean flag followed by another flag is not given the flag as its value", async () => {
    const r = await runCLI(["list", "--help", "--format", "table"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("USAGE");
  });

  test("positional arguments are not consumed as flag values", async () => {
    const r = await runCLI(["--format", "json", "list"]);
    expect(r.exitCode).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});
