import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  filterCommands,
  primaryCommands,
  renderChat,
  renderCommandForm,
  renderCommandInvocation,
  renderPaletteList,
  renderSidebar,
} from "../../public/src/chat-view.js";
import { createDeskState, markEntered, queueFollowUp, reduceDeskEvent } from "../../public/src/event-store.js";

const commands = [
  { id: "setup", title: "Setup", invocation: "/setup", description: "Profile", primaryOrder: 1, arguments: [] },
  { id: "scrape", title: "Find Jobs", invocation: "/scrape", description: "Search", primaryOrder: 2, arguments: [{ kind: "choice", name: "mode", values: ["focused", "broad"] }] },
  { id: "apply", title: "Apply", invocation: "/apply", primaryOrder: 4, arguments: [{ kind: "url", name: "url" }, { kind: "multiline", name: "posting" }] },
  { id: "html-report", title: "HTML report", invocation: "/html-report", arguments: [{ kind: "path", name: "path" }, { kind: "boolean", name: "open", flag: "--open" }] },
];

function document() {
  return new Window({ url: "http://127.0.0.1/" }).document;
}

test("command palette filters and renders invocations", () => {
  assert.deepEqual(filterCommands(commands, "html").map((item) => item.id), ["html-report"]);
  assert.deepEqual(primaryCommands(commands).map((item) => item.id), ["setup", "scrape", "apply"]);
  assert.equal(renderCommandInvocation(commands[2], { posting: "Paste\nme" }), "/apply\nPaste\nme");
  assert.equal(renderCommandInvocation(commands[3], { path: "reports/out.html", open: true }), "/html-report reports/out.html --open");
  assert.match(renderCommandForm(commands[1]), /<select name="mode">/);
  assert.match(renderCommandForm(commands[2]), /<textarea name="posting"/);
});

test("chat view renders stable tool cards, questions, permissions, and queued messages", () => {
  const doc = document();
  const root = doc.createElement("section");
  let state = createDeskState();
  state = reduceDeskEvent(state, {
    eventId: "e1",
    sequence: 1,
    turnId: "t1",
    type: "tool.started",
    payload: { toolUseId: "tool-1", name: "Read" },
  });
  state = reduceDeskEvent(state, {
    eventId: "e2",
    sequence: 2,
    turnId: "t1",
    type: "question.requested",
    payload: { toolUseId: "q-1", questions: [{ question: "Lane?", header: "Lane", options: [{ label: "Healthcare" }] }] },
  });
  state = reduceDeskEvent(state, {
    eventId: "e3",
    sequence: 3,
    type: "permission.requested",
    payload: { requestId: "p-1", toolName: "Write", suggestions: [{ type: "addRules", destination: "session", behavior: "allow" }] },
  });
  state = queueFollowUp(state, { messageId: "m2", text: "rank next" });
  renderChat(root, state);
  assert.equal(root.querySelector('[data-card-id="tool-1"] .tool').textContent.includes("Read"), true);
  assert.equal(root.querySelector('[data-card-id="q-1"] select').disabled, false);
  assert.ok(root.querySelector('[data-card-id="p-1"] [data-decision="allow-scoped"]'));
  assert.equal(root.querySelector('[data-queue-id="m2"]').textContent, "rank next");

  state = markEntered(state, "q-1");
  renderChat(root, state);
  assert.equal(root.querySelector('[data-card-id="q-1"] select').disabled, true);
  assert.equal(root.querySelector('[data-card-id="q-1"]').dataset.entered, "true");
});

test("autofill review cards expose Continue and Cancel only", () => {
  const doc = document();
  const root = doc.createElement("section");
  let state = createDeskState();
  state = reduceDeskEvent(state, {
    eventId: "e-af",
    sequence: 1,
    type: "autofill.review",
    payload: { reviewId: "rev-1", entityId: "rev-1", token: "tok", url: "https://jobs.example/1" },
  });
  renderChat(root, state);
  const card = root.querySelector('[data-card-id="rev-1"]');
  assert.ok(card.querySelector('[data-decision="continue"]'));
  assert.ok(card.querySelector('[data-decision="cancel"]'));
  assert.equal(card.querySelector('[data-decision="submit"]'), null);
  state = markEntered(state, "rev-1");
  renderChat(root, state);
  assert.equal(root.querySelector('[data-decision="continue"]').disabled, true);
});

test("sidebar and palette render primary actions from metadata", () => {
  const doc = document();
  const steps = doc.createElement("nav");
  const palette = doc.createElement("div");
  renderSidebar(steps, commands);
  renderPaletteList(palette, filterCommands(commands, "apply"));
  assert.deepEqual([...steps.querySelectorAll("[data-action]")].map((node) => node.dataset.action), ["setup", "scrape", "apply"]);
  assert.equal(palette.querySelector("[data-command='apply'] strong").textContent, "Apply");
});
