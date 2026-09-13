/** Guards for the tracker status vocabulary. Port of
 * tests/test_tracker_status_vocab.py. */
import { describe, expect, test } from "bun:test";
import { WORKFLOWS, read, section } from "./helpers.ts";

const OUTCOME = `${WORKFLOWS}/04-outcome.md`;
const GMAIL_SYNC = `${WORKFLOWS}/05-gmail-sync.md`;
const HTML_REPORT = `${WORKFLOWS}/html-report.md`;
const NOTION_SYNC = `${WORKFLOWS}/notion-sync.md`;
const APPLY = `${WORKFLOWS}/03-apply.md`;
const INTERVIEW = `${WORKFLOWS}/06-interview.md`;

const VOCAB_ANCHOR = "## Tracker status vocabulary";

describe("vocabulary block exists", () => {
  test("outcome has the vocabulary block", () => {
    expect(read(OUTCOME)).toContain(VOCAB_ANCHOR);
  });

  test("lists underscore canonical spellings", () => {
    const vocab = section(OUTCOME, VOCAB_ANCHOR);
    for (const canonical of ["no_response", "offer_declined"]) {
      expect(vocab).toContain(`\`${canonical}\``);
    }
  });

  test("has read tolerance line", () => {
    const vocab = section(OUTCOME, VOCAB_ANCHOR);
    expect(vocab).toContain("no response");
    expect(vocab).toContain("offer declined");
  });

  test("states equivalence of space forms", () => {
    const vocab = section(OUTCOME, VOCAB_ANCHOR);
    expect(vocab).toContain("same values");
    expect(vocab).toContain("not separate statuses");
    expect(vocab).toContain("equally");
  });

  test("defines open by exclusion", () => {
    const vocab = section(OUTCOME, VOCAB_ANCHOR);
    expect(vocab).toContain("everything else");
  });

  test("step1 section contains all items", () => {
    const step1 = section(OUTCOME, "## Step 1: Load State and Identify the Application");
    for (const needle of ["With an argument", "Without an argument", "Derive the archive"]) {
      expect(step1).toContain(needle);
    }
  });

  test("outcome step4 writes underscore forms", () => {
    const step4 = section(OUTCOME, "## Step 4: Update the Tracker");
    expect(step4).toContain("no_response");
    expect(step4).toContain("offer_declined");
  });
});

describe("readers bucket map", () => {
  test("html-report bucket includes space and underscore forms", () => {
    const step1 = section(HTML_REPORT, "## Step 1: Collect Data");
    for (const v of ["no response", "no_response", "offer declined", "offer_declined"]) {
      expect(step1).toContain(v);
    }
  });

  test("html-report bucket map has a catch-all", () => {
    const step1 = section(HTML_REPORT, "## Step 1: Collect Data");
    expect(step1).toContain("anything else");
    expect(step1).toContain("unrecognised");
  });

  test("html-report bucket does not contain interview_only", () => {
    const step1 = section(HTML_REPORT, "## Step 1: Collect Data");
    expect(step1).not.toContain("interview_only");
  });

  test("notion-sync step4 never writes a space form", () => {
    const step4 = section(NOTION_SYNC, "## Step 4: Upsert Database Rows");
    expect(step4).toContain("never push a space form");
    expect(step4).toContain("Tracker status vocabulary");
  });

  test("notion-sync uses underscore status spellings", () => {
    const step3 = section(NOTION_SYNC, "## Step 3: Load Sync State and Locate the Database");
    expect(step3).toContain("no_response");
    expect(step3).toContain("offer_declined");
    expect(step3).not.toContain("no response");
  });
});

describe("reader cases", () => {
  const CASES: [string, string | null, string][] = [
    [OUTCOME, VOCAB_ANCHOR, "underscores, never spaces"],
    [OUTCOME, VOCAB_ANCHOR, "Final"],
    [HTML_REPORT, "## Step 2: Compute Summary Stats", "excluded from every statistic below"],
    [GMAIL_SYNC, "## Step 9: Staleness Check", "Skip `drafted` rows here"],
    [APPLY, "### Step 6b: Record the Application", "Tracker status vocabulary"],
    [INTERVIEW, "## Step 0: Parse Input", "Tracker status vocabulary"],
  ];

  test("all reader cases", () => {
    for (const [path, heading, needle] of CASES) {
      const haystack = heading ? section(path, heading) : read(path);
      expect(haystack).toContain(needle);
    }
  });
});
