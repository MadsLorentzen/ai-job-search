import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCommandRegistry } from "../command-registry.mjs";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

test("discovers all 16 workflows without duplicates", async () => {
  const registry = await createCommandRegistry({ workspace: REPO });
  const ids = registry.list().map((item) => item.id);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
  for (const id of [
    "setup", "scrape", "rank", "apply", "autofill", "interview", "outcome",
    "import", "expand", "reset", "html-report", "gmail-sync", "notion-sync",
    "add-portal", "add-template", "upskill",
  ]) {
    assert.ok(registry.get(id), `missing ${id}`);
  }
});

test("orders the seven principal actions from metadata", async () => {
  const registry = await createCommandRegistry({ workspace: REPO });
  const primary = registry.list().filter((item) => item.primaryOrder).map((item) => item.id);
  assert.deepEqual(primary, ["setup", "scrape", "rank", "apply", "autofill", "interview", "outcome"]);
});

test("renders url, multiline, path, flags, and positional text exactly", async () => {
  const registry = await createCommandRegistry({ workspace: REPO });
  assert.equal(registry.render("autofill", { url: "https://jobs.example/1" }), "/autofill https://jobs.example/1");
  assert.equal(registry.render("apply", { posting: "Paste\nme" }), "/apply\nPaste\nme");
  assert.equal(registry.render("rank", { all: true, top: 5, focus: "healthcare" }), "/rank healthcare --all --top 5");
  assert.equal(registry.render("html-report", { path: "reports/out.html", open: true }), "/html-report reports/out.html --open");
  assert.equal(registry.render("scrape", { mode: "broad" }), "/scrape broad");
});

test("excludes skills without desk metadata", async () => {
  const registry = await createCommandRegistry({ workspace: REPO });
  assert.equal(registry.get("job-application-assistant"), undefined);
});

test("fails clearly on malformed metadata and picks up a new fixture command", async () => {
  const root = mkdtempSync(join(tmpdir(), "desk-commands-"));
  mkdirSync(join(root, ".claude", "commands"), { recursive: true });
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  writeFileSync(join(root, ".claude", "commands", "broken.md"), "---\ndesk:\n  id: broken\n  invocation: /broken\n  arguments:\n    - kind: nope\n      name: x\n---\n");
  await assert.rejects(() => createCommandRegistry({ workspace: root }), /unknown argument kind/);

  writeFileSync(join(root, ".claude", "commands", "broken.md"), "---\ndesk:\n  id: extra\n  invocation: /extra\n  title: Extra\n---\n# extra\n");
  const registry = await createCommandRegistry({ workspace: root });
  assert.ok(registry.get("extra"));
  assert.equal(registry.render("extra", {}), "/extra");
});
