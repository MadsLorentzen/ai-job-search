import { describe, expect, test } from "bun:test";
import { buildUrl } from "../src/commands/detail";

// buildUrl is the gate between a stored (untrusted) URL and a network fetch.
// It must yield a canonical jobindex fetch target or null (-> BAD_ID) - never
// the raw input. The unguarded version fetched any http(s) URL verbatim and,
// when the path didn't match, used the whole input URL as the id, so a
// non-posting page came back as a well-formed fake posting with exit 0 (#447).

describe("jobindex detail input parsing", () => {
  test("canonical URL with title slug", () => {
    expect(buildUrl("https://www.jobindex.dk/jobannonce/h1647303/senior-data-engineer")).toEqual({
      url: "https://www.jobindex.dk/jobannonce/h1647303",
      id: "h1647303",
    });
  });

  test("trailing slash and query string variants", () => {
    expect(buildUrl("https://www.jobindex.dk/jobannonce/r13677312/")?.id).toBe("r13677312");
    expect(buildUrl("https://www.jobindex.dk/jobannonce/h1647303?utm_source=x")?.id).toBe("h1647303");
  });

  test("jobindex subdomains and bare apex are accepted", () => {
    expect(buildUrl("https://it.jobindex.dk/jobannonce/h1647303")?.id).toBe("h1647303");
    expect(buildUrl("https://jobindex.dk/jobannonce/h1647303")?.id).toBe("h1647303");
  });

  test("a bare id builds the canonical URL (server 404s unknowns loudly)", () => {
    expect(buildUrl("h1647303")).toEqual({
      url: "https://www.jobindex.dk/jobannonce/h1647303",
      id: "h1647303",
    });
  });

  test("an off-host URL is rejected, not fetched", () => {
    expect(buildUrl("https://evil.example/jobannonce/h1647303")).toBeNull();
  });

  test("look-alike and userinfo hosts are rejected", () => {
    expect(buildUrl("https://jobindex.dk.evil.example/jobannonce/h1647303")).toBeNull();
    expect(buildUrl("https://www.jobindex.dk@evil.example/jobannonce/h1647303")).toBeNull();
  });

  test("an own-host URL without a jobannonce id is rejected (the fake-posting repro)", () => {
    expect(buildUrl("https://www.jobindex.dk/")).toBeNull();
  });

  test("garbage bare input is rejected", () => {
    expect(buildUrl("not a slug!")).toBeNull();
    expect(buildUrl("ftp://www.jobindex.dk/jobannonce/h1")).toBeNull();
  });
});
