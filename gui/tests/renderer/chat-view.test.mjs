import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  activityFor,
  answersFromQuestionForm,
  commandInputError,
  commandNeedsInput,
  describeTool,
  filterCommands,
  primaryCommands,
  renderChat,
  renderCommandForm,
  renderCommandInvocation,
  renderPaletteList,
  renderSidebar,
  seedSetupPrompt,
} from "../../public/src/chat-view.js";
import { createDeskState, markEntered, queueFollowUp, reduceDeskEvent } from "../../public/src/event-store.js";

const commands = [
  { id: "setup", title: "Setup", invocation: "/setup", description: "Profile", primaryOrder: 1, arguments: [] },
  { id: "scrape", title: "Find Jobs", invocation: "/scrape", description: "Search", primaryOrder: 2, arguments: [{ kind: "choice", name: "mode", values: ["focused", "broad"] }] },
  { id: "apply", title: "Apply", invocation: "/apply", primaryOrder: 4, arguments: [{ kind: "url", name: "url" }, { kind: "multiline", name: "posting" }] },
  { id: "html-report", title: "HTML report", invocation: "/html-report", arguments: [{ kind: "path", name: "path" }, { kind: "boolean", name: "open", flag: "--open" }] },
  { id: "autofill", title: "Autofill", invocation: "/autofill", primaryOrder: 5, arguments: [{ kind: "url", name: "url", required: true }] },
];

function document() {
  return new Window({ url: "http://127.0.0.1/" }).document;
}

test("command palette filters and renders invocations", () => {
  assert.deepEqual(filterCommands(commands, "html").map((item) => item.id), ["html-report"]);
  assert.deepEqual(primaryCommands(commands).map((item) => item.id), ["setup", "scrape", "apply", "autofill"]);
  assert.equal(renderCommandInvocation(commands[2], { posting: "Paste\nme" }), "/apply\nPaste\nme");
  assert.equal(renderCommandInvocation(commands[3], { path: "reports/out.html", open: true }), "/html-report reports/out.html --open");
  // Optional arguments never produce a form: the step runs at once.
  assert.equal(renderCommandForm(commands[1]), "");
  assert.equal(commandNeedsInput(commands[1]), false);
  assert.equal(commandNeedsInput(commands[3]), false);
  // Link-or-posting commands get one paste box; a required link gets one field with a plain label.
  assert.equal(commandNeedsInput(commands[2]), true);
  assert.match(renderCommandForm(commands[2]), /<textarea name="paste"/);
  assert.doesNotMatch(renderCommandForm(commands[2]), /name="url"|name="posting"/);
  assert.match(renderCommandForm(commands[4]), /<span>Link<\/span><input name="url" type="url"/);
});

test("the paste box turns a link into the url argument and anything else into the posting", () => {
  assert.equal(renderCommandInvocation(commands[2], { paste: "  https://jobs.example/1 " }), "/apply https://jobs.example/1");
  assert.equal(renderCommandInvocation(commands[2], { paste: "Senior Engineer\nAcme" }), "/apply\nSenior Engineer\nAcme");
  assert.equal(commandInputError(commands[2], { paste: "  " }), "Paste a job link or the posting text first.");
  assert.equal(commandInputError(commands[2], { paste: "https://jobs.example/1" }), "");
  assert.equal(commandInputError(commands[4], { url: "" }), "Link is required.");
  assert.match(commandInputError(commands[4], { url: "not a link" }), /does not look like a web link/);
  assert.equal(commandInputError(commands[4], { url: "boards.example.com/jobs/1" }), "", "a bare domain is accepted");
  assert.equal(renderCommandInvocation(commands[4], { url: "boards.example.com/jobs/1" }), "/autofill https://boards.example.com/jobs/1");
  assert.equal(renderCommandInvocation(commands[2], { paste: "boards.example.com/jobs/1" }), "/apply https://boards.example.com/jobs/1");
  assert.equal(commandInputError(commands[4], { url: "https://boards.example/1" }), "");
});

test("Setup is a short optional form that seeds /setup", () => {
  assert.equal(commandNeedsInput(commands[0]), true);
  assert.match(renderCommandForm(commands[0]), /name="setupName"/);
  assert.match(renderCommandForm(commands[0]), /name="setupLocation"/);
  assert.equal(seedSetupPrompt({}), "/setup");
  assert.equal(renderCommandInvocation(commands[0], {}), "/setup");
  const seeded = seedSetupPrompt({ setupName: "Sam Lee", setupLocation: "Austin, TX", setupTarget: "Staff engineer" });
  assert.match(seeded, /^\/setup\n/);
  assert.match(seeded, /Name: Sam Lee/);
  assert.match(seeded, /Location: Austin, TX/);
  assert.match(seeded, /Target roles: Staff engineer/);
  assert.equal(commandInputError(commands[0], {}), "");
});

test("streaming updates a card in place instead of rebuilding the log", () => {
  const doc = document();
  const root = doc.createElement("section");
  let state = createDeskState();
  state = reduceDeskEvent(state, { eventId: "u1", sequence: 1, turnId: "t1", type: "user.message", payload: { messageId: "m1", text: "hi" } });
  state = reduceDeskEvent(state, { eventId: "d1", sequence: 2, turnId: "t1", type: "assistant.delta", payload: { text: "Hel" } });
  renderChat(root, state);
  const user = root.querySelector('[data-card-id="m1"]');
  const reply = root.querySelector('[data-card-id="assistant:t1"]');
  assert.ok(user.classList.contains("enter"));
  assert.ok(reply.classList.contains("enter"));
  // Simulate the browser finishing the entrance animation.
  user.classList.remove("enter");
  reply.classList.remove("enter");

  state = reduceDeskEvent(state, { eventId: "d2", sequence: 3, turnId: "t1", type: "assistant.delta", payload: { text: "lo" } });
  renderChat(root, state);
  assert.equal(root.querySelector('[data-card-id="m1"]'), user, "user card is the same DOM node");
  assert.equal(root.querySelector('[data-card-id="assistant:t1"]'), reply, "reply card is the same DOM node");
  assert.equal(reply.classList.contains("enter"), false, "an updated card does not re-run its entrance animation");
  assert.equal(reply.querySelector(".body").textContent, "Hello");
  assert.equal(root.querySelectorAll("article").length, 2);
});

test("the chat shows what Claude is doing while a turn runs", () => {
  const doc = document();
  const root = doc.createElement("section");
  let state = createDeskState();
  state = reduceDeskEvent(state, { eventId: "u1", sequence: 1, turnId: "t1", type: "user.message", payload: { messageId: "m1", text: "hi" } });
  renderChat(root, state);
  assert.equal(root.querySelector(".activity")?.dataset.activity, "Working");

  state = reduceDeskEvent(state, { eventId: "th", sequence: 2, turnId: "t1", type: "assistant.thinking", payload: {} });
  renderChat(root, state);
  assert.equal(root.querySelector(".activity").dataset.activity, "Thinking");
  assert.equal(root.querySelectorAll("article").length, 1, "thinking adds no card");

  state = reduceDeskEvent(state, { eventId: "t", sequence: 3, turnId: "t1", type: "tool.started", payload: { toolUseId: "tool-1", name: "Read", input: { file_path: "cv/main.tex" } } });
  renderChat(root, state);
  assert.equal(activityFor(state), "Reading cv/main.tex");
  assert.equal(root.querySelector('[data-card-id="tool-1"] .tool').textContent, "Reading cv/main.tex");

  state = reduceDeskEvent(state, { eventId: "c", sequence: 4, turnId: "t1", type: "tool.completed", payload: { toolUseId: "tool-1", text: "ok" } });
  state = reduceDeskEvent(state, { eventId: "d", sequence: 5, turnId: "t1", type: "assistant.delta", payload: { text: "Here" } });
  renderChat(root, state);
  assert.equal(root.querySelector(".activity").dataset.activity, "Writing");

  state = reduceDeskEvent(state, { eventId: "r", sequence: 6, turnId: "t1", type: "turn.completed", payload: { text: "Here" } });
  renderChat(root, state);
  assert.equal(root.querySelector(".activity"), null);
  assert.equal(describeTool("Bash", { description: "Compile the CV" }), "Running Compile the CV");
  assert.equal(describeTool("Mystery", {}), "Using Mystery");
});

test("a failed turn is labelled as a problem, not as stopped", () => {
  const doc = document();
  const root = doc.createElement("section");
  let state = createDeskState();
  state = reduceDeskEvent(state, { eventId: "f", sequence: 1, turnId: "t1", type: "turn.failed", payload: { text: "Claude exited with code 1" } });
  renderChat(root, state);
  assert.equal(root.querySelector(".msg.error .who").textContent, "Problem");
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
  const radio = root.querySelector('[data-card-id="q-1"] input[type="radio"]');
  assert.equal(radio.disabled, false);
  assert.equal(radio.value, "Healthcare");
  assert.ok(root.querySelector('[data-card-id="q-1"] input[name="q0__other"]'), "a Something else box exists");
  assert.equal(root.querySelector('[data-card-id="q-1"] select'), null, "no dropdowns");
  assert.ok(root.querySelector('[data-card-id="p-1"] [data-decision="allow-scoped"]'));
  assert.equal(root.querySelector('[data-queue-id="m2"]').textContent, "rank next");
  assert.equal(root.querySelector(".activity"), null, "no Working row while Claude waits on the person");

  state = markEntered(state, "q-1");
  renderChat(root, state);
  assert.equal(root.querySelector('[data-card-id="q-1"] input[type="radio"]').disabled, true);
  assert.equal(root.querySelector('[data-card-id="q-1"]').dataset.entered, "true");
});

test("question answers are keyed by the question text; typed text beats a ticked option", () => {
  const doc = document();
  const root = doc.createElement("section");
  const questions = [
    { question: "Which lane?", header: "Lane", options: [{ label: "Healthcare", description: "Hospitals" }, { label: "Defense", description: "" }], multiSelect: false },
    { question: "Which boards?", header: "Boards", options: [{ label: "LinkedIn" }, { label: "Ashby" }], multiSelect: true },
    { question: "Anything else?", header: "Notes" },
  ];
  let state = createDeskState();
  state = reduceDeskEvent(state, { eventId: "e1", sequence: 1, type: "question.requested", payload: { entityId: "req-1", questions } });
  renderChat(root, state);
  const form = root.querySelector('form[data-id="req-1"]');
  assert.ok(form.querySelector(".q-option em")?.textContent.includes("Hospitals"), "option descriptions are shown");
  form.querySelector('input[name="q0"][value="Defense"]').checked = true;
  form.querySelector('input[name="q1"][value="LinkedIn"]').checked = true;
  form.querySelector('input[name="q1__other"]').value = "Wellfound";
  form.querySelector('textarea[name="q2"]').value = " Remote only ";
  assert.deepEqual(answersFromQuestionForm(form, questions), {
    "Which lane?": "Defense",
    "Which boards?": ["LinkedIn", "Wellfound"],
    "Anything else?": "Remote only",
  });
  form.querySelector('input[name="q0__other"]').value = "Climate";
  assert.equal(answersFromQuestionForm(form, questions)["Which lane?"], "Climate");

  state = reduceDeskEvent(state, { eventId: "e2", sequence: 2, type: "question.resolved", payload: { entityId: "req-1", answered: true } });
  renderChat(root, state);
  assert.equal(root.querySelector('form[data-id="req-1"] button[type="submit"]'), null);
  assert.ok(root.querySelector('form[data-id="req-1"] > .hint').textContent.includes("Answered"));
});

test("print mode shows a read-only question and permission cards use the SDK title", () => {
  const doc = document();
  const root = doc.createElement("section");
  let state = createDeskState();
  state = reduceDeskEvent(state, { eventId: "e1", sequence: 1, type: "question.requested", payload: { entityId: "tool-q", toolUseId: "tool-q", readOnly: true, questions: [{ question: "Which lane?", header: "Lane", options: [{ label: "Healthcare" }] }] } });
  state = reduceDeskEvent(state, { eventId: "e2", sequence: 2, type: "permission.requested", payload: { entityId: "req-p", toolName: "Bash", input: { command: "rm -rf build", description: "Clean build" }, title: "Claude wants to run rm -rf build", suggestions: [] } });
  renderChat(root, state);
  const question = root.querySelector('[data-card-id="tool-q"]');
  assert.equal(question.querySelector("form"), null, "nothing to submit in print mode");
  assert.ok(question.textContent.includes("message box at the bottom"));
  assert.ok(question.querySelector(".q-list li strong")?.textContent === "Healthcare", "choices listed plainly");
  const permission = root.querySelector('[data-card-id="req-p"]');
  assert.ok(permission.textContent.includes("Claude wants to run rm -rf build"));
  assert.equal(permission.querySelector('[data-decision="allow-scoped"]'), null);
  assert.ok(permission.querySelector('[data-decision="deny"]').textContent.includes("Don"));
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
  assert.deepEqual([...steps.querySelectorAll("[data-action]")].map((node) => node.dataset.action), ["setup", "scrape", "apply", "autofill"]);
  assert.equal(palette.querySelector("[data-command='apply'] strong").textContent, "Apply");
});
