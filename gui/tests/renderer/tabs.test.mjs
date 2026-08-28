import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { mountTabs } from "../../public/src/tabs.js";

function withDom() {
  const window = new Window({ url: "http://127.0.0.1/" });
  const { document } = window;
  document.body.innerHTML = `
    <div id="surface-tabs"></div>
    <section id="panel-chat"></section>
    <section id="panel-terminal"></section>
    <section id="panel-files"></section>
  `;
  return { window, document };
}

test("tabs expose accessible ARIA state and only the selected tab is tabbable", () => {
  const { document } = withDom();
  const selected = [];
  const tabs = mountTabs(document.getElementById("surface-tabs"), {
    selectedId: "chat",
    onSelect: (id) => selected.push(id),
  });
  const buttons = [...document.querySelectorAll("[role='tab']")];
  assert.equal(buttons.length, 3);
  assert.equal(document.querySelector("[role='tablist']").getAttribute("aria-label"), "Desk surfaces");
  assert.equal(buttons[0].getAttribute("aria-selected"), "true");
  assert.equal(buttons[0].tabIndex, 0);
  assert.equal(buttons[1].tabIndex, -1);
  assert.equal(document.getElementById("panel-chat").hidden, false);
  assert.equal(document.getElementById("panel-terminal").hidden, true);

  buttons[1].dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true }));
  assert.equal(tabs.selectedId(), "terminal");
  assert.equal(buttons[1].getAttribute("aria-selected"), "true");
  assert.equal(buttons[1].tabIndex, 0);
  assert.equal(buttons[0].tabIndex, -1);
  assert.deepEqual(selected, ["terminal"]);
});

test("arrow keys move tab focus", () => {
  const { document } = withDom();
  const tabs = mountTabs(document.getElementById("surface-tabs"));
  const list = document.querySelector("[role='tablist']");
  list.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(tabs.selectedId(), "terminal");
  list.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(tabs.selectedId(), "files");
  list.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  assert.equal(tabs.selectedId(), "chat");
});
