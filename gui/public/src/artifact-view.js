function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function groupArtifactsByTurn(artifacts) {
  const groups = new Map();
  for (const artifact of artifacts) {
    const key = artifact.turnId || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(artifact);
  }
  return [...groups.entries()].map(([turnId, items]) => ({ turnId, items }));
}

export function createArtifactViewState(seed = {}) {
  return {
    status: seed.status || (seed.artifacts?.length ? "ready" : "empty"),
    error: seed.error || null,
    artifacts: seed.artifacts || [],
    selectedId: seed.selectedId || seed.artifacts?.[0]?.id || null,
    preview: seed.preview || null,
    compare: seed.compare || null,
    confirm: seed.confirm || null,
  };
}

function previewHtml(preview) {
  if (!preview) return `<p class="artifact-empty">Select a file to preview.</p>`;
  if (preview.kind === "html") {
    const src = preview.src || "";
    return `<iframe class="artifact-html" sandbox="allow-same-origin" src="${escapeHtml(src)}" title="HTML preview"></iframe>`;
  }
  if (preview.kind === "image") {
    return `<img class="artifact-image" alt="${escapeHtml(preview.relativePath || "image")}" src="${escapeHtml(preview.src || "")}">`;
  }
  if (preview.kind === "pdf") {
    return `<iframe class="artifact-pdf" src="${escapeHtml(preview.src || "")}" title="PDF preview"></iframe>`;
  }
  if (preview.kind === "text") {
    return `<pre class="artifact-text">${escapeHtml(preview.text || "")}</pre>`;
  }
  return `<p class="artifact-empty">This file type cannot be previewed.</p>`;
}

export function renderArtifactView(container, state, { title = "Files" } = {}) {
  const document = container.ownerDocument;
  container.replaceChildren();
  container.classList.add("artifact-view");
  container.tabIndex = 0;

  if (state.status === "loading") {
    container.innerHTML = `<div class="empty" data-state="loading"><p class="kicker">${escapeHtml(title)}</p><h2>Loading files…</h2></div>`;
    return;
  }
  if (state.status === "error") {
    container.innerHTML = `<div class="empty" data-state="error"><p class="kicker">${escapeHtml(title)}</p><h2>Could not load files.</h2><p>${escapeHtml(state.error || "Try again.")}</p></div>`;
    return;
  }
  if (state.status === "empty" || !state.artifacts.length) {
    container.innerHTML = `<div class="empty" data-state="empty"><p class="kicker">${escapeHtml(title)}</p><h2>No artifacts yet.</h2><p>Generated CVs, letters, and reports will appear here.</p></div>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "artifact-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Artifacts");
  for (const group of groupArtifactsByTurn(state.artifacts)) {
    const heading = document.createElement("p");
    heading.className = "kicker";
    heading.textContent = `Turn ${group.turnId}`;
    list.append(heading);
    for (const artifact of group.items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "artifact-item";
      button.dataset.artifactId = artifact.id;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(artifact.id === state.selectedId));
      button.tabIndex = artifact.id === state.selectedId ? 0 : -1;
      button.innerHTML = `<strong>${escapeHtml(artifact.relativePath)}</strong><em>${escapeHtml(artifact.kind)}</em>`;
      list.append(button);
    }
  }

  const preview = document.createElement("div");
  preview.className = "artifact-preview";
  preview.dataset.kind = state.preview?.kind || "none";
  preview.innerHTML = previewHtml(state.preview);
  if (state.compare?.diff) {
    const diff = document.createElement("pre");
    diff.className = "artifact-diff";
    diff.textContent = state.compare.diff;
    preview.append(diff);
  }

  const actions = document.createElement("div");
  actions.className = "artifact-actions";
  for (const [action, label] of [["preview", "Preview"], ["compare", "Compare"], ["open", "Open"], ["reveal", "Reveal"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.artifactAction = action;
    button.disabled = !state.selectedId;
    button.textContent = label;
    if (action === "open" || action === "reveal") button.className = "ghost";
    actions.append(button);
  }

  if (state.confirm) {
    const confirm = document.createElement("div");
    confirm.className = "artifact-confirm";
    confirm.dataset.confirm = state.confirm.action;
    confirm.innerHTML = `<p>${state.confirm.action === "open" ? "Open this file with the operating system?" : "Reveal this file in the file manager?"}</p>
      <button type="button" data-confirm="yes">Continue</button>
      <button type="button" class="ghost" data-confirm="no">Cancel</button>`;
    actions.append(confirm);
  }

  container.append(list, preview, actions);
}

export function moveArtifactSelection(state, delta) {
  if (!state.artifacts.length) return state;
  const index = Math.max(0, state.artifacts.findIndex((item) => item.id === state.selectedId));
  const next = state.artifacts[(index + delta + state.artifacts.length) % state.artifacts.length];
  return { ...state, selectedId: next.id, preview: null, compare: null, confirm: null };
}

export function requestArtifactConfirm(state, action) {
  if (action !== "open" && action !== "reveal") return { ...state, confirm: null };
  return { ...state, confirm: { action, id: state.selectedId } };
}
