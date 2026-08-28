import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCommandRegistry } from "../command-registry.mjs";
import {
  primaryCommands,
  renderCommandForm,
  renderCommandInvocation,
  renderSidebar,
} from "../public/src/chat-view.js";

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXPECTED = [
  "setup", "scrape", "rank", "apply", "autofill", "interview", "outcome",
  "expand", "import", "html-report", "gmail-sync", "notion-sync",
  "add-template", "add-portal", "reset", "upskill",
];

test("all 16 workflow commands are registered and raw invocations stay available", async () => {
  const registry = await createCommandRegistry({ workspace: WORKSPACE });
  const commands = registry.list();
  const ids = commands.map((item) => item.id);
  for (const id of EXPECTED) {
    assert.ok(ids.includes(id), `missing command ${id}`);
    assert.match(registry.get(id).invocation, /^\//);
  }
  assert.equal(registry.render("scrape", {}), "/scrape");
  assert.equal(registry.render("rank", {}), "/rank");
});

test("primary sidebar derives from metadata and Apply keeps pasted newlines", async () => {
  const registry = await createCommandRegistry({ workspace: WORKSPACE });
  const commands = registry.list();
  const primary = primaryCommands(commands).map((item) => item.id);
  assert.deepEqual(primary, ["setup", "scrape", "rank", "apply", "autofill", "interview", "outcome"]);

  const apply = registry.get("apply");
  const rendered = renderCommandInvocation(apply, {
    url: "https://jobs.example/1",
    posting: "Line one\nLine two",
  });
  assert.match(rendered, /Line one\nLine two/);

  const window = new Window({ url: "http://127.0.0.1/" });
  const nav = window.document.createElement("nav");
  renderSidebar(nav, commands);
  assert.deepEqual(
    [...nav.querySelectorAll("[data-action]")].map((node) => node.dataset.action),
    primary,
  );
});

test("Autofill requires a URL and Reset cannot run from the form without interaction", async () => {
  const registry = await createCommandRegistry({ workspace: WORKSPACE });
  const autofill = registry.get("autofill");
  assert.equal(autofill.arguments.some((argument) => argument.kind === "url" && argument.required), true);
  assert.equal(renderCommandInvocation(autofill, {}), "/autofill");
  assert.equal(renderCommandInvocation(autofill, { url: "https://jobs.example/1" }), "/autofill https://jobs.example/1");
  assert.match(renderCommandForm(autofill), /type="url"/);

  const reset = registry.get("reset");
  assert.ok(reset);
  const deskJs = await import("node:fs/promises").then((fs) => fs.readFile(join(WORKSPACE, "gui", "public", "src", "desk.js"), "utf8"));
  assert.match(deskJs, /window\.confirm/);
  assert.match(deskJs, /New conversation/);
});
