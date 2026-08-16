import { describe, test, expect } from "bun:test";
import { parseOracleAtsId } from "../src/ats";

// Oracle Cloud HCM "Candidate Experience" is tenant-hosted: the API host cannot
// be derived from the company name, so ats_id carries both halves as
// "<host>|<siteNumber>". Verified live against UBP:
// "iaadtu.fa.ocs.oraclecloud.eu|CX_1".

describe("parseOracleAtsId", () => {
  test("splits host and site number", () => {
    expect(parseOracleAtsId("iaadtu.fa.ocs.oraclecloud.eu|CX_1")).toEqual({
      host: "iaadtu.fa.ocs.oraclecloud.eu",
      siteNumber: "CX_1",
    });
  });

  test("tolerates a pasted scheme — people copy the URL bar", () => {
    expect(parseOracleAtsId("https://iaadtu.fa.ocs.oraclecloud.eu|CX_1")?.host).toBe(
      "iaadtu.fa.ocs.oraclecloud.eu",
    );
  });

  test("tolerates a trailing slash on the host", () => {
    expect(parseOracleAtsId("iaadtu.fa.ocs.oraclecloud.eu/|CX_1")?.host).toBe(
      "iaadtu.fa.ocs.oraclecloud.eu",
    );
  });

  test.each([
    ["no separator", "iaadtu.fa.ocs.oraclecloud.eu"],
    ["missing site number", "iaadtu.fa.ocs.oraclecloud.eu|"],
    ["missing host", "|CX_1"],
    ["empty", ""],
  ])("rejects %s so the caller can raise a useful error", (_label, value) => {
    expect(parseOracleAtsId(value)).toBeNull();
  });
});
