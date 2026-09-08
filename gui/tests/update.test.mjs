import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFakeUpdateState, getUpdateState, requestUpdateInstall, setUpdateState } from "../update.mjs";

test("applyFakeUpdateState is off by default and on with the test flag", () => {
  setUpdateState({ channel: "idle", version: "", current: "" });
  assert.equal(applyFakeUpdateState({}), false);
  assert.equal(getUpdateState().channel, "idle");
  assert.equal(applyFakeUpdateState({ JOB_SEARCH_UPDATE_FAKE: "1" }), true);
  const fake = getUpdateState();
  assert.equal(fake.channel, "downloaded");
  assert.equal(fake.version, "1.9.9");
});

test("requestUpdateInstall fails until an installer is registered", () => {
  const result = requestUpdateInstall();
  assert.equal(result.ok, false);
});
