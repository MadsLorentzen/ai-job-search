const DEFAULT_RESIZE_MS = 80;

export function createTerminalView({
  terminalFactory,
  fitAddonFactory,
  ResizeObserverImpl = globalThis.ResizeObserver,
  bridge,
  resizeDebounceMs = DEFAULT_RESIZE_MS,
} = {}) {
  let terminal = null;
  let fitAddon = null;
  let observer = null;
  let resizeTimer = null;
  let disposed = false;
  let inputEnabled = true;
  const unsubscribers = [];

  function fit() {
    try { fitAddon?.fit?.(); } catch { /* container may be hidden */ }
    if (bridge?.resize && terminal) {
      bridge.resize({ cols: terminal.cols, rows: terminal.rows });
    }
  }

  function scheduleFit() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fit, resizeDebounceMs);
  }

  return {
    mount(container) {
      if (disposed) throw new Error("disposed");
      terminal = terminalFactory();
      fitAddon = fitAddonFactory();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      if (typeof terminal.onData === "function") {
        const sub = terminal.onData((data) => {
          if (!inputEnabled) return;
          bridge?.write?.(data);
        });
        if (typeof sub === "function") unsubscribers.push(sub);
        else if (sub?.dispose) unsubscribers.push(() => sub.dispose());
      }
      if (ResizeObserverImpl) {
        observer = new ResizeObserverImpl(() => scheduleFit());
        observer.observe(container);
      }
      queueMicrotask(fit);
      return terminal;
    },
    write(data) {
      terminal?.write?.(data);
    },
    setInputEnabled(enabled) {
      inputEnabled = Boolean(enabled);
    },
    focus() {
      terminal?.focus?.();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(resizeTimer);
      observer?.disconnect?.();
      for (const stop of unsubscribers) stop();
      fitAddon?.dispose?.();
      terminal?.dispose?.();
      terminal = null;
      fitAddon = null;
    },
    get inputEnabled() { return inputEnabled; },
    get disposed() { return disposed; },
  };
}
