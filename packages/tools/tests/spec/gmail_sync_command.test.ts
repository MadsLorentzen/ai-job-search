/** Guards for /gmail-sync's Gmail query semantics. Port of
 * tests/test_gmail_sync_command.py. */
import { describe, expect, test } from "bun:test";
import { WORKFLOWS, read } from "./helpers.ts";

const GMAIL_SYNC = `${WORKFLOWS}/05-gmail-sync.md`;

describe("/gmail-sync query operators", () => {
  test("query excludes sent and drafts explicitly", () => {
    expect(read(GMAIL_SYNC)).toContain("-in:sent -in:drafts");
  });

  test("query never restricts to the inbox", () => {
    const text = read(GMAIL_SYNC).split("-in:sent").join("").split("-in:drafts").join("");
    expect(text).not.toContain("in:inbox");
  });
});
