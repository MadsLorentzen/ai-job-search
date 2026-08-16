import { describe, expect, test } from "bun:test";
import { jsonFetch, htmlFetch } from "../src/helpers";
import { recordingFetch, stubResponse } from "./helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts and a stubbed sleep returns
// immediately, so the exhaustion cases never sleep through the real
// 500ms -> 6s schedule. jsonFetch and htmlFetch carry separate copies of the
// loop, so both are exercised to keep them from drifting apart.
//
// Note this CLI's ceiling is the initial attempt plus four retries (five calls),
// not the seven the Danish portal CLIs use. Pinned here so the number is a
// decision on the record rather than an accident.

const noSleep = async () => {};

describe("htmlFetch retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    const { impl, calls } = recordingFetch([stubResponse(429), stubResponse(200, "<html>ok</html>")]);
    const html = await htmlFetch("https://acme.example/careers", { fetchImpl: impl, sleep: noSleep });
    expect(html).toContain("ok");
    expect(calls).toHaveLength(2);
  });

  test("retries a 503 and succeeds on the next attempt", async () => {
    const { impl, calls } = recordingFetch([stubResponse(503), stubResponse(200, "<html>ok</html>")]);
    await htmlFetch("https://acme.example/careers", { fetchImpl: impl, sleep: noSleep });
    expect(calls).toHaveLength(2);
  });

  test("does not retry a plain 4xx", async () => {
    const { impl, calls } = recordingFetch([stubResponse(400)]);
    await expect(
      htmlFetch("https://acme.example/careers", { fetchImpl: impl, sleep: noSleep }),
    ).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
  });

  test("gives up after the initial attempt plus four retries on persistent 5xx", async () => {
    const { impl, calls } = recordingFetch([stubResponse(500)]);
    await expect(
      htmlFetch("https://acme.example/careers", { fetchImpl: impl, sleep: noSleep }),
    ).rejects.toThrow(/500/);
    expect(calls).toHaveLength(5);
  });

  test("the exhaustion error carries a failure class, not just a status", async () => {
    const { impl } = recordingFetch([stubResponse(500)]);
    await expect(
      htmlFetch("https://acme.example/careers", { fetchImpl: impl, sleep: noSleep }),
    ).rejects.toThrow(/server_error/);
  });

  test("backoff grows and is capped rather than climbing without limit", async () => {
    const waits: number[] = [];
    const { impl } = recordingFetch([stubResponse(500)]);
    await expect(
      htmlFetch("https://acme.example/careers", {
        fetchImpl: impl,
        sleep: async (ms) => {
          waits.push(ms);
        },
      }),
    ).rejects.toThrow();
    expect(waits).toHaveLength(4);
    // Jitter is up to 400ms, so compare against the floor of each step.
    expect(waits[1]).toBeGreaterThanOrEqual(1000);
    expect(waits[3]).toBeGreaterThanOrEqual(4000);
    for (const w of waits) expect(w).toBeLessThanOrEqual(6400);
  });

  test("a retried request keeps identifying honestly on every attempt", async () => {
    const { impl, calls } = recordingFetch([stubResponse(500)]);
    await expect(
      htmlFetch("https://acme.example/careers", { fetchImpl: impl, sleep: noSleep }),
    ).rejects.toThrow();
    for (const c of calls) expect(c.headers["User-Agent"]).not.toContain("Mozilla");
  });
});

describe("jsonFetch retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    const { impl, calls } = recordingFetch([stubResponse(429), stubResponse(200, '{"ok":true}')]);
    const data = (await jsonFetch("https://api.example/jobs", {
      fetchImpl: impl,
      sleep: noSleep,
    })) as { ok: boolean };
    expect(data.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("does not retry a plain 4xx", async () => {
    const { impl, calls } = recordingFetch([stubResponse(400)]);
    await expect(
      jsonFetch("https://api.example/jobs", { fetchImpl: impl, sleep: noSleep }),
    ).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
  });

  test("gives up after the initial attempt plus four retries on persistent 5xx", async () => {
    const { impl, calls } = recordingFetch([stubResponse(500)]);
    await expect(
      jsonFetch("https://api.example/jobs", { fetchImpl: impl, sleep: noSleep }),
    ).rejects.toThrow(/500/);
    expect(calls).toHaveLength(5);
  });

  test("404 is a missing board, not an error — it returns null without retrying", async () => {
    const { impl, calls } = recordingFetch([stubResponse(404)]);
    const data = await jsonFetch("https://api.example/jobs", { fetchImpl: impl, sleep: noSleep });
    expect(data).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("a 403 on a JSON API is not escalated to browser headers", async () => {
    // Only the generic HTML path escalates. An ATS API answering 403 is a real
    // refusal, and retrying it in disguise would be exactly the override the
    // robots posture forbids.
    const { impl, calls } = recordingFetch([stubResponse(403)]);
    await expect(
      jsonFetch("https://api.example/jobs", { fetchImpl: impl, sleep: noSleep }),
    ).rejects.toThrow(/bot_blocked/);
    expect(calls).toHaveLength(1);
  });
});
