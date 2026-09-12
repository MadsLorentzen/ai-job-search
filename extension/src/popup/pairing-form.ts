import type { ServerClient } from "../background/server-client";
import type { CredentialStore } from "../background/credential-store";

export type PairingResult = { ok: true } | { ok: false; message: string };

export async function attemptPairing(
  code: string,
  serverClient: ServerClient,
  credentialStore: CredentialStore,
): Promise<PairingResult> {
  try {
    const { durableSecret } = await serverClient.exchangePairing(code);
    await credentialStore.set(durableSecret);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
