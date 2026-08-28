const DEFAULT_TABS = [
  { id: "chat", label: "Chat" },
  { id: "terminal", label: "Terminal" },
  { id: "files", label: "Files" },
];

export function mountTabs(container, {
  tabs = DEFAULT_TABS,
  selectedId = "chat",
  onSelect,
} = {}) {
  container.replaceChildren();
  const list = container.ownerDocument.createElement("div");
  list.className = "tablist";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "Desk surfaces");

  const buttons = tabs.map((tab) => {
    const button = container.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.id = `tab-${tab.id}`;
    button.setAttribute("role", "tab");
    button.dataset.tab = tab.id;
    button.textContent = tab.label;
    list.append(button);
    return button;
  });

  container.append(list);
  let current = selectedId;

  function paint() {
    for (const button of buttons) {
      const selected = button.dataset.tab === current;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("selected", selected);
      const panel = container.ownerDocument.getElementById(`panel-${button.dataset.tab}`);
      if (panel) {
        panel.hidden = !selected;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", button.id);
      }
    }
  }

  function select(id, { focus = false } = {}) {
    if (!tabs.some((tab) => tab.id === id)) return current;
    current = id;
    paint();
    if (focus) buttons.find((button) => button.dataset.tab === id)?.focus();
    onSelect?.(id);
    return current;
  }

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (button) select(button.dataset.tab, { focus: true });
  });

  list.addEventListener("keydown", (event) => {
    const index = buttons.findIndex((button) => button.dataset.tab === current);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      select(tabs[(index + 1) % tabs.length].id, { focus: true });
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      select(tabs[(index - 1 + tabs.length) % tabs.length].id, { focus: true });
    } else if (event.key === "Home") {
      event.preventDefault();
      select(tabs[0].id, { focus: true });
    } else if (event.key === "End") {
      event.preventDefault();
      select(tabs[tabs.length - 1].id, { focus: true });
    }
  });

  paint();
  return {
    select,
    selectedId() {
      return current;
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
