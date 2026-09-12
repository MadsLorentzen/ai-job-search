import { describe, expect, it, vi } from "vitest";
import { ServerClient } from "../src/background/server-client";

describe("ServerClient.exchangePairing", () => {
  it("posts the one-time secret and returns the durable credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ credential_id: "extcred_1", durable_secret: "durable-abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ServerClient(async () => null);
    const result = await client.exchangePairing("one-time-code");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8420/api/handoff/pairing/exchange",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ one_time_secret: "one-time-code" }),
      }),
    );
    expect(result).toEqual({ credentialId: "extcred_1", durableSecret: "durable-abc" });
    vi.unstubAllGlobals();
  });

  it("throws with the server's detail message on a failed exchange", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "pairing code expired" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ServerClient(async () => null);
    await expect(client.exchangePairing("stale-code")).rejects.toThrow("pairing code expired");
    vi.unstubAllGlobals();
  });

  it("never sends an X-Handoff-Credential header for this call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ credential_id: "extcred_1", durable_secret: "durable-abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ServerClient(async () => { throw new Error("should never be called"); });
    await client.exchangePairing("one-time-code");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).not.toHaveProperty("X-Handoff-Credential");
    vi.unstubAllGlobals();
  });
});
