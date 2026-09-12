import { describe, expect, it, vi } from "vitest";
import { attemptPairing } from "../src/popup/pairing-form";
import type { ServerClient } from "../src/background/server-client";
import type { CredentialStore } from "../src/background/credential-store";

function makeServerClient(overrides: Partial<ServerClient> = {}): ServerClient {
  return {
    exchangePairing: vi.fn().mockResolvedValue({ credentialId: "extcred_1", durableSecret: "durable-abc" }),
    ...overrides,
  } as unknown as ServerClient;
}

function makeCredentialStore(): CredentialStore {
  return { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined), clear: vi.fn() } as unknown as CredentialStore;
}

describe("attemptPairing", () => {
  it("writes the durable credential to CredentialStore on success", async () => {
    const serverClient = makeServerClient();
    const credentialStore = makeCredentialStore();

    const result = await attemptPairing("one-time-code", serverClient, credentialStore);

    expect(result).toEqual({ ok: true });
    expect(credentialStore.set).toHaveBeenCalledWith("durable-abc");
    expect(serverClient.exchangePairing).toHaveBeenCalledWith("one-time-code");
  });

  it("returns a failure result without writing to CredentialStore when exchange rejects", async () => {
    const serverClient = makeServerClient({
      exchangePairing: vi.fn().mockRejectedValue(new Error("pairing code expired")),
    });
    const credentialStore = makeCredentialStore();

    const result = await attemptPairing("stale-code", serverClient, credentialStore);

    expect(result).toEqual({ ok: false, message: "pairing code expired" });
    expect(credentialStore.set).not.toHaveBeenCalled();
  });
});
