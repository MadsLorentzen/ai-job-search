import type { CandidateSnapshot } from "../adapters/types";

// The background worker (background/index.ts) writes the candidate
// snapshot to this key on the page's global object as part of the same
// chrome.scripting.executeScript call that injects the content script
// bundle, immediately before it — the content script (content/index.ts)
// then reads it back here. This avoids a second message round-trip just
// to hand over data the background worker already fetched.
export const INJECTED_SNAPSHOT_KEY = "__jobsearch_handoff_snapshot__";

export function readInjectedSnapshot(
  globalObj: Record<string, unknown>,
): CandidateSnapshot | null {
  const value = globalObj[INJECTED_SNAPSHOT_KEY];
  if (typeof value !== "object" || value === null) return null;
  return value as CandidateSnapshot;
}
