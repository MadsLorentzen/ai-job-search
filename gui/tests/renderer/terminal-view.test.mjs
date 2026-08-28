import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createTerminalView } from "../../public/src/terminal-view.js";

function factories({ writes = [], resizes = [] } = {}) {
  const addons = [];
  const dataListeners = [];
  const terminal = {
    cols: 80,
    rows: 24,
    loadAddon(addon) { addons.push(addon); },
    open(container) { this.container = container; },
    onData(listener) {
      dataListeners.push(listener);
      return () => {
        const index = dataListeners.indexOf(listener);
        if (index >= 0) dataListeners.splice(index, 1);
      };
    },
    write(data) { writes.push(data); },
    focus() { this.focused = true; },
    dispose() { this.disposed = true; },
    emit(data) { for (const listener of dataListeners) listener(data); },
  };
  const fitAddon = {
    fit() { this.fitted = true; },
    dispose() { this.disposed = true; },
  };
  const observed = [];
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; }
    observe(node) { observed.push(node); }
    disconnect() { this.disconnected = true; }
  }
  return {
    terminal,
    fitAddon,
    observed,
    FakeResizeObserver,
    terminalFactory: () => terminal,
    fitAddonFactory: () => fitAddon,
    bridge: {
      write(data) { writes.push(`pty:${data}`); },
      resize(size) { resizes.push(size); },
    },
    writes,
    resizes,
  };
}

test("terminal view mounts, forwards input, fits, and disposes", async () => {
  const window = new Window({ url: "http://127.0.0.1/" });
  const container = window.document.createElement("div");
  const writes = [];
  const resizes = [];
  const f = factories({ writes, resizes });
  const view = createTerminalView({
    terminalFactory: f.terminalFactory,
    fitAddonFactory: f.fitAddonFactory,
    ResizeObserverImpl: f.FakeResizeObserver,
    bridge: f.bridge,
    resizeDebounceMs: 5,
  });
  view.mount(container);
  assert.equal(f.terminal.container, container);
  f.terminal.emit("ls\r");
  assert.deepEqual(writes, ["pty:ls\r"]);
  view.setInputEnabled(false);
  f.terminal.emit("blocked");
  assert.deepEqual(writes, ["pty:ls\r"]);
  view.write("out");
  assert.ok(writes.includes("out"));
  view.focus();
  assert.equal(f.terminal.focused, true);
  f.observed[0] && f.FakeResizeObserver.prototype;
  await new Promise((resolve) => setTimeout(resolve, 15));
  view.dispose();
  assert.equal(f.terminal.disposed, true);
  assert.equal(f.fitAddon.disposed, true);
  assert.equal(view.disposed, true);
});

test("terminal view does not load a web-links addon", () => {
  const source = createTerminalView.toString();
  assert.equal(source.includes("web-links"), false);
  assert.equal(source.includes("WebLinks"), false);
});
