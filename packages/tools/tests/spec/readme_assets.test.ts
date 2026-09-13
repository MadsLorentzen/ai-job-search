/** Every local image referenced by README.md must exist. Port of
 * tests/test_readme_assets.py. */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO, read } from "./helpers.ts";

function localRefs(): string[] {
  const text = read(`${REPO}/README.md`);
  const refs = [
    ...text.matchAll(/<img[^>]+src="([^"]+)"/g),
    ...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g),
  ].map((m) => m[1]!);
  return refs.filter((r) => !r.startsWith("http://") && !r.startsWith("https://"));
}

describe("README image references", () => {
  test("readme references at least one local image", () => {
    expect(localRefs().length).toBeGreaterThanOrEqual(1);
  });

  test("all local image references resolve", () => {
    for (const ref of localRefs()) {
      expect(existsSync(join(REPO, ref))).toBe(true);
    }
  });
});
