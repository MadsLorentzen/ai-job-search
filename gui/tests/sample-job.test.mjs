import assert from "node:assert/strict";
import { test } from "node:test";
import { attachSample, SAMPLE_POSTING } from "../sample-job.mjs";

test("attachSample offers a practice card only on an empty board", () => {
  const empty = attachSample({ jobs: [] });
  assert.equal(empty.sample.company, "Northstar Practice Labs");
  assert.equal(empty.sample.sample, true);
  assert.equal(empty.samplePosting, SAMPLE_POSTING);

  const full = attachSample({ jobs: [{ company: "Acme" }] });
  assert.equal(full.sample, null);
  assert.equal(full.samplePosting, SAMPLE_POSTING);
});

test("the practice posting refuses to be treated as a live employer", () => {
  assert.match(SAMPLE_POSTING, /PRACTICE POSTING/);
  assert.match(SAMPLE_POSTING, /not a real employer/i);
});
