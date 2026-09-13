/** Port of tests/test_job_key.py - the canonical seen_jobs.json key function. */
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { isCanonical, isLegacyShape, makeKey, slugify } from "../src/job_key.ts";
import { runCli } from "./helpers.ts";

describe("slugify", () => {
  test("basic", () => {
    expect(slugify("Acme Corp")).toBe("acme-corp");
  });

  test("strips punctuation that breaks paths", () => {
    expect(slugify("Ops Consulting, LLC")).toBe("ops-consulting-llc");
    expect(slugify("Penetration Tester / Red Teamer")).toBe("penetration-tester-red-teamer");
    expect(slugify("Junior Cybersecurity Analyst (OT/IoT)")).toBe(
      "junior-cybersecurity-analyst-ot-iot",
    );
  });

  test("non-latin script reduces to empty", () => {
    expect(slugify("시큐리온")).toBe("");
    expect(slugify("Код Безопасности")).toBe("");
  });
});

describe("makeKey", () => {
  test("shape", () => {
    const key = makeKey("Acme Corp", "SOC Analyst (L2)");
    expect(key).toBe("acme-corp_soc-analyst-l2");
    expect(isCanonical(key)).toBe(true);
  });

  test("deterministic across calls", () => {
    const title = "Cyber Intelligence Center Security Analyst with an unusually long title";
    expect(makeKey("Deloitte", title)).toBe(makeKey("Deloitte", title));
  });

  test("long titles never collide after truncation", () => {
    const a = makeKey("Deloitte", "Cyber Intelligence Center Security Analyst with trailing text A");
    const b = makeKey("Deloitte", "Cyber Intelligence Center Security Analyst with trailing text B");
    expect(a).not.toBe(b);
  });

  test("non-latin title falls back to the portal job id", () => {
    const key = makeKey(
      "SecuriON",
      "안드로이드 앱(악성코드) 분석가 채용",
      "https://kr.linkedin.com/jobs/view/x-4461771225",
    );
    expect(key).toBe("securion_4461771225");
  });

  test("non-latin title with no url id still produces a canonical key", () => {
    const key = makeKey("SecuriON", "안드로이드 앱 분석가", "");
    expect(isCanonical(key)).toBe(true);
    expect(key).not.toBe("securion_");
  });

  test("non-latin company falls back without producing a bare prefix", () => {
    const key = makeKey("Код Безопасности", "Malware Analytic", "");
    expect(isCanonical(key)).toBe(true);
    expect(key.startsWith("_")).toBe(false);
  });
});

describe("canonical and legacy shape", () => {
  test("canonical accepts company underscore title", () => {
    expect(isCanonical("acme-corp_soc-analyst")).toBe(true);
  });

  test("canonical rejects path-breaking characters", () => {
    for (const bad of [
      "deloitte_junior-cybersecurity-analyst-(ot/iot)",
      "neverhack-estonia_penetration-tester-/-red-teamer",
      "ops-consulting,-llc_malware-analyst",
      "",
      "securion_",
    ]) {
      expect(isCanonical(bad)).toBe(false);
    }
  });

  test("legacy three-part shape is flagged separately from malformed", () => {
    expect(isLegacyShape("nviso-security_soc-analyst_athens")).toBe(true);
    expect(isCanonical("nviso-security_soc-analyst_athens")).toBe(false);
    // A malformed key (bad characters) is never also reported as legacy shape.
    expect(isLegacyShape("deloitte_junior-cybersecurity-analyst-(ot/iot)")).toBe(false);
  });
});

describe("audit CLI", () => {
  const runAudit = (seen: Record<string, unknown>) => {
    const path = `${tmpdir()}/job_key_audit_${Math.random().toString(36).slice(2)}.json`;
    Bun.write(path, JSON.stringify({ seen }));
    const proc = runCli(["job-key", "--audit", path]);
    return { report: JSON.parse(proc.stdout), code: proc.exitCode };
  };

  test("clean state exits zero", () => {
    const { report, code } = runAudit({ "acme_soc-analyst": { company: "Acme", title: "SOC Analyst" } });
    expect(code).toBe(0);
    expect(report.malformed_keys).toEqual([]);
    expect(report.duplicate_urls).toEqual({});
  });

  test("malformed key exits nonzero", () => {
    const { report, code } = runAudit({
      "deloitte_junior-cybersecurity-analyst-(ot/iot)": { company: "Deloitte", title: "x" },
    });
    expect(code).toBe(1);
    expect(report.malformed_keys).toContain("deloitte_junior-cybersecurity-analyst-(ot/iot)");
  });

  test("duplicate url exits nonzero", () => {
    const { report, code } = runAudit({
      a: { company: "Acme", title: "x", url: "https://x/1" },
      b: { company: "Acme", title: "y", url: "https://x/1" },
    });
    expect(code).toBe(1);
    expect(Object.keys(report.duplicate_urls)).toContain("https://x/1");
  });

  test("legacy shape alone does not fail the audit", () => {
    const { report, code } = runAudit({ acme_soc_analyst_athens: { company: "Acme", title: "x" } });
    expect(code).toBe(0);
    expect(report.legacy_three_part_keys).toContain("acme_soc_analyst_athens");
  });
});
