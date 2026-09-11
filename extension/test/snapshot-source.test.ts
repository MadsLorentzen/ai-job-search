import { describe, expect, it } from "vitest";
import { INJECTED_SNAPSHOT_KEY, readInjectedSnapshot } from "../src/content/snapshot-source";
import type { CandidateSnapshot } from "../src/adapters/types";

function makeSnapshot(): CandidateSnapshot {
  return {
    identity: { name: { value: "Jane Doe", profile_evidence_ids: ["clm_1"] } },
    contact: {},
    employment: [],
  };
}

describe("readInjectedSnapshot", () => {
  it("reads the snapshot from the well-known global key", () => {
    const snapshot = makeSnapshot();
    const fakeGlobal = { [INJECTED_SNAPSHOT_KEY]: snapshot };

    expect(readInjectedSnapshot(fakeGlobal)).toBe(snapshot);
  });

  it("returns null when no snapshot was injected", () => {
    expect(readInjectedSnapshot({})).toBeNull();
  });

  it("returns null rather than throwing when the key holds a non-object value", () => {
    expect(readInjectedSnapshot({ [INJECTED_SNAPSHOT_KEY]: "not-a-snapshot" })).toBeNull();
  });
});
