const CREDENTIAL_KEY = "handoff_extension_credential";

// The ONLY module that ever reads or writes the durable extension
// credential (design spec Section 5). Content scripts never import this.
export class CredentialStore {
  async get(): Promise<string | null> {
    const result = await chrome.storage.local.get(CREDENTIAL_KEY);
    return (result[CREDENTIAL_KEY] as string | undefined) ?? null;
  }

  async set(credential: string): Promise<void> {
    await chrome.storage.local.set({ [CREDENTIAL_KEY]: credential });
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(CREDENTIAL_KEY);
  }
}
