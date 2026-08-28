import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  createArtifactViewState,
  groupArtifactsByTurn,
  moveArtifactSelection,
  renderArtifactView,
  requestArtifactConfirm,
} from "../../public/src/artifact-view.js";

function document() {
  return new Window({ url: "http://127.0.0.1/" }).document;
}

const artifacts = [
  { id: "a1", turnId: "t1", relativePath: "cv/one.tex", kind: "created", previewKind: "text" },
  { id: "a2", turnId: "t1", relativePath: "cover.html", kind: "created", previewKind: "html" },
  { id: "a3", turnId: "t2", relativePath: "report.pdf", kind: "modified", previewKind: "pdf" },
];

test("artifacts group by turn and render empty, loading, and error states", () => {
  assert.deepEqual(groupArtifactsByTurn(artifacts).map((group) => [group.turnId, group.items.length]), [
    ["t1", 2],
    ["t2", 1],
  ]);
  const root = document().createElement("section");
  renderArtifactView(root, createArtifactViewState({ status: "empty" }));
  assert.equal(root.querySelector("[data-state='empty'] h2").textContent, "No artifacts yet.");
  renderArtifactView(root, createArtifactViewState({ status: "loading" }));
  assert.equal(root.querySelector("[data-state='loading']").textContent.includes("Loading"), true);
  renderArtifactView(root, createArtifactViewState({ status: "error", error: "Nope" }));
  assert.equal(root.querySelector("[data-state='error'] p:last-child").textContent, "Nope");
});

test("preview selection uses sandbox for HTML and never injects HTML into the desk document", () => {
  const root = document().createElement("section");
  renderArtifactView(root, createArtifactViewState({
    artifacts,
    selectedId: "a2",
    preview: { kind: "html", src: "/artifacts/a2/preview", relativePath: "cover.html" },
  }));
  const frame = root.querySelector("iframe.artifact-html");
  assert.equal(frame.getAttribute("sandbox"), "allow-same-origin");
  assert.equal(frame.getAttribute("src"), "/artifacts/a2/preview");
  assert.equal(root.innerHTML.includes("<p>unsafe"), false);

  renderArtifactView(root, createArtifactViewState({
    artifacts,
    selectedId: "a3",
    preview: { kind: "pdf", src: "/artifacts/a3/preview" },
  }));
  assert.ok(root.querySelector("iframe.artifact-pdf"));

  renderArtifactView(root, createArtifactViewState({
    artifacts,
    selectedId: "a1",
    preview: { kind: "text", text: "hello" },
  }));
  assert.equal(root.querySelector(".artifact-text").textContent, "hello");

  renderArtifactView(root, createArtifactViewState({
    artifacts,
    selectedId: "a1",
    preview: { kind: "image", src: "/artifacts/a1/preview", relativePath: "shot.png" },
  }));
  assert.equal(root.querySelector("img.artifact-image").getAttribute("src"), "/artifacts/a1/preview");
});

test("Open and Reveal require confirmation and arrow keys move selection", () => {
  const root = document().createElement("section");
  let state = createArtifactViewState({ artifacts, selectedId: "a1" });
  state = requestArtifactConfirm(state, "open");
  renderArtifactView(root, state);
  assert.equal(root.querySelector("[data-confirm='yes']").textContent, "Continue");
  assert.equal(root.querySelector(".artifact-confirm").dataset.confirm, "open");
  state = requestArtifactConfirm(state, "reveal");
  assert.equal(state.confirm.action, "reveal");
  state = moveArtifactSelection(state, 1);
  assert.equal(state.selectedId, "a2");
  renderArtifactView(root, state);
  const selected = root.querySelector("[aria-selected='true']");
  assert.equal(selected.dataset.artifactId, "a2");
  assert.equal(selected.tabIndex, 0);
});
