import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ROBOTS_CHECK_PY,
  robotsCheckPyGate,
  curlFallback,
  htmlFetch,
  UA,
  type RobotsGate,
} from "../src/helpers";
import { recordingFetch, stubResponse } from "./helpers";

// The posture these tests pin, from 09-web-research.md: the browser-header retry
// exists to get past bot-filtering firewalls on sites whose robots.txt permits
// access. It is never used to override a site that has said no. Every case here
// is offline — the gate is stubbed, or a fixture script stands in for it.

let dir: string;
const script = (name: string, body: string): string => {
  const p = join(dir, name);
  writeFileSync(p, body, { mode: 0o755 });
  return p;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cps-robots-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("gate wiring", () => {
  test("ROBOTS_CHECK_PY resolves to the checker that actually ships in this repo", () => {
    // Guards against the path drifting silently: a gate pointing at nothing
    // fails closed, which would disable the retry everywhere without a word.
    expect(ROBOTS_CHECK_PY.endsWith(join("tools", "robots_check.py"))).toBe(true);
    expect(existsSync(ROBOTS_CHECK_PY)).toBe(true);
  });

  test("there is no second robots implementation to drift from it", async () => {
    const src = await Bun.file(join(import.meta.dir, "../src/helpers.ts")).text();
    expect(src).not.toContain("Disallow");
    expect(src).toContain("robots_check.py");
  });
});

describe("robotsCheckPyGate fails closed", () => {
  test("exit 0 grants permission", async () => {
    const s = script("ok.py", "import sys; sys.exit(0)\n");
    expect(await robotsCheckPyGate("https://example.com/jobs", s)).toBe(true);
  });

  test("exit 1 (disallowed or unconfirmed) refuses", async () => {
    const s = script("no.py", "import sys; sys.exit(1)\n");
    expect(await robotsCheckPyGate("https://example.com/jobs", s)).toBe(false);
  });

  test("exit 2 (usage error) refuses rather than assuming permission", async () => {
    const s = script("usage.py", "import sys; sys.exit(2)\n");
    expect(await robotsCheckPyGate("https://example.com/jobs", s)).toBe(false);
  });

  test("a crashing checker refuses", async () => {
    const s = script("boom.py", "raise SystemError('boom')\n");
    expect(await robotsCheckPyGate("https://example.com/jobs", s)).toBe(false);
  });

  test("a missing checker refuses", async () => {
    expect(await robotsCheckPyGate("https://example.com/jobs", join(dir, "absent.py"))).toBe(false);
  });

  test("a missing python interpreter refuses", async () => {
    const s = script("ok2.py", "import sys; sys.exit(0)\n");
    expect(await robotsCheckPyGate("https://example.com/jobs", s, "python3-does-not-exist")).toBe(false);
  });

  test("the URL is passed through to the checker verbatim", async () => {
    const out = join(dir, "seen.txt");
    const s = script(
      "echo.py",
      `import sys\nopen(${JSON.stringify(out)}, "w").write(sys.argv[1])\nsys.exit(0)\n`,
    );
    const url = "https://example.com/careers/?q=security#frag";
    expect(await robotsCheckPyGate(url, s)).toBe(true);
    expect(await Bun.file(out).text()).toBe(url);
  });
});

describe("curlFallback obeys the gate", () => {
  test("a refusing gate returns no HTML and never shells out", async () => {
    let asked = 0;
    const deny: RobotsGate = async () => {
      asked++;
      return false;
    };
    expect(await curlFallback("https://example.com/jobs", deny)).toBe("");
    expect(asked).toBe(1);
  });

  test("the gate is consulted before curl runs, not after", async () => {
    const order: string[] = [];
    const gate: RobotsGate = async () => {
      order.push("gate");
      return false;
    };
    await curlFallback("https://example.com/jobs", gate);
    expect(order).toEqual(["gate"]);
  });
});

describe("htmlFetch identifies honestly by default", () => {
  test("a successful fetch sends the skill's own User-Agent, not a browser's", async () => {
    const { impl, calls } = recordingFetch([stubResponse(200, "<html>ok</html>")]);
    const body = await htmlFetch("https://example.com/jobs", { fetchImpl: impl });
    expect(body).toBe("<html>ok</html>");
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["User-Agent"]).toBe(UA);
    expect(calls[0].headers["User-Agent"]).not.toContain("Mozilla");
  });

  test("a successful fetch does not consult the robots gate at all", async () => {
    let asked = 0;
    const { impl } = recordingFetch([stubResponse(200, "<html>ok</html>")]);
    await htmlFetch("https://example.com/jobs", {
      fetchImpl: impl,
      gate: async () => {
        asked++;
        return true;
      },
    });
    expect(asked).toBe(0);
  });

  test("404 returns empty without escalating", async () => {
    let curled = 0;
    const { impl } = recordingFetch([stubResponse(404)]);
    const body = await htmlFetch("https://example.com/jobs", {
      fetchImpl: impl,
      curl: async () => {
        curled++;
        return "<html>should not happen</html>";
      },
    });
    expect(body).toBe("");
    expect(curled).toBe(0);
  });

  test("500 retries and never escalates to browser headers", async () => {
    let curled = 0;
    const { impl, calls } = recordingFetch([stubResponse(500), stubResponse(200, "<html>ok</html>")]);
    const body = await htmlFetch("https://example.com/jobs", {
      fetchImpl: impl,
      sleep: async () => {},
      curl: async () => {
        curled++;
        return "";
      },
    });
    expect(body).toBe("<html>ok</html>");
    expect(curled).toBe(0);
    for (const c of calls) expect(c.headers["User-Agent"]).toBe(UA);
  });
});

describe("htmlFetch escalation on 403", () => {
  test("403 with a permitting gate returns the curl body", async () => {
    const { impl } = recordingFetch([stubResponse(403)]);
    const body = await htmlFetch("https://example.com/jobs", {
      fetchImpl: impl,
      gate: async () => true,
      curl: async (_url, gate) => ((await gate(_url)) ? "<html>via curl</html>" : ""),
    });
    expect(body).toBe("<html>via curl</html>");
  });

  test("403 with a refusing gate throws instead of returning a scraped page", async () => {
    const { impl } = recordingFetch([stubResponse(403)]);
    const p = htmlFetch("https://example.com/jobs", {
      fetchImpl: impl,
      gate: async () => false,
      curl: async (_url, gate) => ((await gate(_url)) ? "<html>via curl</html>" : ""),
    });
    // The message must say WHICH of the two happened: a site we may not fetch
    // and a site whose WAF beat us are different problems with different fixes.
    await expect(p).rejects.toThrow(/robots_unconfirmed/);
    await expect(p).rejects.toThrow(/does not permit this path/);
  });

  test("401 escalates on the same path as 403", async () => {
    const { impl } = recordingFetch([stubResponse(401)]);
    const body = await htmlFetch("https://example.com/jobs", {
      fetchImpl: impl,
      gate: async () => true,
      curl: async () => "<html>via curl</html>",
    });
    expect(body).toBe("<html>via curl</html>");
  });

  test("the gate receives the exact URL being fetched", async () => {
    const seen: string[] = [];
    const { impl } = recordingFetch([stubResponse(403)]);
    await htmlFetch("https://example.com/careers/geneva", {
      fetchImpl: impl,
      gate: async (u) => {
        seen.push(u);
        return true;
      },
      curl: async (u, g) => ((await g(u)) ? "<html>ok</html>" : ""),
    });
    expect(seen).toEqual(["https://example.com/careers/geneva"]);
  });
});

describe("transport errors are classified, not left bare", () => {
  const throwingFetch = (err: Error): typeof fetch =>
    (async () => {
      throw err;
    }) as unknown as typeof fetch;

  test("a timeout surfaces as [timeout] rather than an unlabelled message", async () => {
    const p = htmlFetch("https://example.com/jobs", {
      fetchImpl: throwingFetch(new Error("The operation timed out.")),
    });
    await expect(p).rejects.toThrow(/\[timeout\]/);
  });

  test("a bad certificate surfaces as [tls_error]", async () => {
    const p = htmlFetch("https://example.com/jobs", {
      fetchImpl: throwingFetch(new Error("unable to verify the first certificate")),
    });
    await expect(p).rejects.toThrow(/\[tls_error\]/);
  });

  test("a DNS failure surfaces as [dns_failure]", async () => {
    const p = htmlFetch("https://nope.example/jobs", {
      fetchImpl: throwingFetch(new Error("getaddrinfo ENOTFOUND nope.example")),
    });
    await expect(p).rejects.toThrow(/\[dns_failure\]/);
  });

  test("the failing URL is named, so a multi-entry scan says which one broke", async () => {
    const p = htmlFetch("https://example.com/careers", {
      fetchImpl: throwingFetch(new Error("The operation timed out.")),
    });
    await expect(p).rejects.toThrow(/example\.com\/careers/);
  });

  test("a transport error is not mistaken for a block — the gate is never consulted", async () => {
    let asked = 0;
    const p = htmlFetch("https://example.com/jobs", {
      fetchImpl: throwingFetch(new Error("The operation timed out.")),
      gate: async () => {
        asked++;
        return true;
      },
    });
    await expect(p).rejects.toThrow();
    expect(asked).toBe(0);
  });
});
