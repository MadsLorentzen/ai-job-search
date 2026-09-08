function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function filterCommands(commands, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [...commands];
  return commands.filter((command) => {
    const haystack = [command.id, command.title, command.invocation, command.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function primaryCommands(commands) {
  return commands
    .filter((command) => Number.isFinite(command.primaryOrder))
    .sort((left, right) => left.primaryOrder - right.primaryOrder);
}

// ---------------------------------------------------------------------------
// Command input
//
// A sidebar click should do the obvious thing. Commands whose arguments are all
// optional run at once with their defaults; the composer accepts the flags for
// anyone who wants them. A form appears only when the command cannot run
// without something from the user: a required argument, or the "link or pasted
// posting" pair that /apply and /import take.

const PASTE_FIELD = "paste";

function hasKind(command, kind) {
  return (command.arguments || []).some((argument) => argument.kind === kind);
}

export function commandTakesPaste(command) {
  return hasKind(command, "url") && hasKind(command, "multiline");
}

export function commandNeedsInput(command) {
  if (!command) return false;
  if (command.id === "setup") return true;
  if (commandTakesPaste(command)) return true;
  return (command.arguments || []).some((argument) => argument.required);
}

export function seedSetupPrompt(values = {}) {
  const name = String(values.setupName || "").trim();
  const location = String(values.setupLocation || "").trim();
  const target = String(values.setupTarget || "").trim();
  const notes = String(values.setupNotes || "").trim();
  if (!name && !location && !target && !notes) return "/setup";
  const lines = [
    "/setup",
    "",
    "I already filled what I know. Use Path A if documents/cv has a resume, otherwise Path C for anything still blank. Do not re-ask fields that have a value.",
  ];
  if (name) lines.push(`Name: ${name}`);
  if (location) lines.push(`Location: ${location}`);
  if (target) lines.push(`Target roles: ${target}`);
  if (notes) lines.push(`Notes: ${notes}`);
  return lines.join("\n");
}

const FIELD_LABELS = {
  url: "Link",
  posting: "Posting text",
  company: "Company or role",
  focus: "Focus",
  query: "What to look for",
  section: "Section",
  path: "File path",
  source: "Template file",
  use: "Template to use",
  mode: "Mode",
  scope: "What to reset",
  minScore: "Minimum score",
  top: "How many",
};

const COMMAND_PLACEHOLDERS = {
  autofill: "https://boards.greenhouse.io/company/jobs/123",
  apply: "Paste the job link. If the site blocks links, paste the whole posting instead.",
  import: "Paste the job link, or the whole posting.",
};

function labelFor(argument) {
  return argument.label || FIELD_LABELS[argument.name] || argument.name;
}

function looksLikeUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || "").trim());
}

// "boards.greenhouse.io/acme/jobs/1" pasted from an address bar that hides
// the scheme is a link too.
function looksLikeBareDomain(value) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(String(value || "").trim());
}

function asUrl(value) {
  const text = String(value || "").trim();
  if (looksLikeUrl(text)) return text;
  if (looksLikeBareDomain(text)) return `https://${text}`;
  return "";
}

export function normalizeCommandValues(command, values = {}) {
  if (!commandTakesPaste(command)) return { ...values };
  const { [PASTE_FIELD]: pasted, ...rest } = values;
  const text = String(pasted || "").trim();
  if (!text) return rest;
  const urlArgument = (command.arguments || []).find((argument) => argument.kind === "url");
  const postingArgument = (command.arguments || []).find((argument) => argument.kind === "multiline");
  const url = /\s/.test(text) ? "" : asUrl(text);
  if (url) return { ...rest, [urlArgument.name]: url };
  return { ...rest, [postingArgument.name]: text };
}

export function commandInputError(command, values = {}) {
  if (!command) return "";
  if (command.id === "setup") return "";
  if (commandTakesPaste(command)) {
    const normalized = normalizeCommandValues(command, values);
    const filled = (command.arguments || []).some((argument) => {
      const value = normalized[argument.name];
      return value != null && String(value).trim() !== "";
    });
    return filled ? "" : "Paste a job link or the posting text first.";
  }
  for (const argument of command.arguments || []) {
    if (!argument.required) continue;
    const value = values[argument.name];
    if (value == null || String(value).trim() === "") return `${labelFor(argument)} is required.`;
    if (argument.kind === "url" && !asUrl(value)) return "That does not look like a web link. Paste the address from your browser, for example https://boards.greenhouse.io/company/jobs/123.";
  }
  return "";
}

export function renderCommandInvocation(command, values = {}) {
  if (command?.id === "setup") return seedSetupPrompt(values);
  const normalized = normalizeCommandValues(command, values);
  const parts = [command.invocation];
  let multiline = "";
  for (const argument of command.arguments || []) {
    const value = normalized[argument.name];
    if (value == null || value === "" || value === false) continue;
    if (argument.kind === "boolean") {
      parts.push(argument.flag.startsWith("--") ? argument.flag : `--${argument.flag}`);
      continue;
    }
    if (argument.kind === "multiline") {
      multiline = String(value);
      continue;
    }
    const text = argument.kind === "url" ? (asUrl(value) || String(value)) : String(value);
    if (argument.flag) {
      parts.push(argument.flag.startsWith("--") ? argument.flag : `--${argument.flag}`, text);
      continue;
    }
    parts.push(text);
  }
  const rendered = parts.join(" ").trim();
  return multiline ? `${rendered}\n${multiline}` : rendered;
}

export function renderCommandForm(command) {
  if (command?.id === "setup") {
    return `<label data-arg="setupName"><span>Name, as it should appear on a CV</span><input name="setupName" type="text" autocomplete="name" placeholder="Optional"></label>
<label data-arg="setupLocation"><span>Where you live</span><input name="setupLocation" type="text" autocomplete="address-level2" placeholder="City, state. Remote is fine."></label>
<label data-arg="setupTarget"><span>Roles you want</span><input name="setupTarget" type="text" placeholder="Staff engineer, research scientist"></label>
<label data-arg="setupNotes"><span>Anything else Claude should know</span><textarea name="setupNotes" rows="4" placeholder="Optional. Skip any field; Claude will ask."></textarea></label>`;
  }
  if (commandTakesPaste(command)) {
    const placeholder = escapeHtml(COMMAND_PLACEHOLDERS[command.id] || "Paste a link or the full text.");
    return `<label data-arg="${PASTE_FIELD}"><span>Job link or posting</span><textarea name="${PASTE_FIELD}" rows="6" placeholder="${placeholder}"></textarea></label>`;
  }
  const fields = (command.arguments || []).filter((argument) => argument.required).map((argument) => {
    const name = escapeHtml(argument.name);
    const label = escapeHtml(labelFor(argument));
    const placeholder = escapeHtml(argument.placeholder || COMMAND_PLACEHOLDERS[command.id] || "");
    if (argument.kind === "choice") {
      const options = (argument.values || []).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
      return `<label data-arg="${name}"><span>${label}</span><select name="${name}">${options}</select></label>`;
    }
    if (argument.kind === "boolean") {
      return `<label class="check" data-arg="${name}"><input type="checkbox" name="${name}"> ${label}</label>`;
    }
    if (argument.kind === "multiline") {
      return `<label data-arg="${name}"><span>${label}</span><textarea name="${name}" rows="8" placeholder="${placeholder}"></textarea></label>`;
    }
    const type = argument.kind === "url" ? "url" : argument.kind === "integer" ? "number" : "text";
    return `<label data-arg="${name}"><span>${label}</span><input name="${name}" type="${type}" placeholder="${placeholder}"></label>`;
  });
  return fields.join("");
}

export function valuesFromForm(form) {
  const values = {};
  for (const field of form.querySelectorAll("[name]")) {
    if (field.type === "checkbox") values[field.name] = field.checked;
    else if (field.multiple) values[field.name] = [...field.selectedOptions].map((option) => option.value);
    else values[field.name] = field.value;
  }
  return values;
}

// ---------------------------------------------------------------------------
// Questions from Claude (AskUserQuestion)
//
// The SDK keys answers by the question text; the form uses positional names
// and maps back here. A typed "something else" wins over a ticked option.

function questionKey(question, index) {
  return question.question || question.header || `q${index}`;
}

export function answersFromQuestionForm(form, questions = []) {
  const answers = {};
  questions.forEach((question, index) => {
    const name = `q${index}`;
    const other = form.querySelector(`[name="${name}__other"]`)?.value?.trim() || "";
    const options = question.options || [];
    if (!options.length) {
      const text = form.querySelector(`[name="${name}"]`)?.value?.trim() || "";
      if (text) answers[questionKey(question, index)] = text;
      return;
    }
    const picked = [...form.querySelectorAll(`[name="${name}"]`)].filter((input) => input.checked).map((input) => input.value);
    if (question.multiSelect) {
      const list = [...picked, ...(other ? [other] : [])];
      if (list.length) answers[questionKey(question, index)] = list;
    } else if (other) {
      answers[questionKey(question, index)] = other;
    } else if (picked[0]) {
      answers[questionKey(question, index)] = picked[0];
    }
  });
  return answers;
}

export function questionAnswersError(questions = [], answers = {}) {
  const missing = questions.filter((question, index) => answers[questionKey(question, index)] == null);
  if (!missing.length) return "";
  return questions.length === 1 ? "Pick an answer or type your own first." : "Answer every question first.";
}

// ---------------------------------------------------------------------------
// Cards

function whoFor(type) {
  if (type === "user.message") return "You";
  if (type === "turn.failed") return "Problem";
  if (type === "desk.notice") return "Desk";
  if (type.startsWith("question") || type.startsWith("permission") || type.startsWith("autofill")) return "Needs you";
  if (type === "artifact.discovered") return "Saved";
  if (type === "subagent.activity") return "Helper";
  return "Claude";
}

function cardClass(card) {
  if (card.type === "user.message") return "msg user";
  if (card.type === "turn.failed") return "msg error";
  if (card.type === "desk.notice") return "msg notice";
  if (card.type.startsWith("tool")) return "msg assistant card-tool";
  if (card.type === "artifact.discovered") return "msg assistant card-tool card-artifact";
  if (card.type === "subagent.activity") return "msg assistant card-subagent";
  if (card.type.startsWith("question")) return "msg assistant card-question";
  if (card.type.startsWith("permission")) return "msg assistant card-permission";
  if (card.type.startsWith("autofill")) return "msg assistant card-autofill";
  return "msg assistant";
}

const TOOL_VERBS = {
  Read: "Reading",
  Write: "Writing",
  Edit: "Editing",
  MultiEdit: "Editing",
  NotebookEdit: "Editing",
  Bash: "Running",
  Grep: "Searching",
  Glob: "Searching",
  LS: "Listing",
  WebFetch: "Fetching",
  WebSearch: "Searching the web",
  Agent: "Running a helper agent",
  Task: "Running a helper agent",
  Skill: "Running",
  TodoWrite: "Planning",
};

function toolDetail(input = {}) {
  const detail = input.file_path || input.path || input.notebook_path || input.description || input.query || input.url || input.pattern || input.skill || input.command || "";
  const text = String(detail || "").replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 71)}…` : text;
}

export function describeTool(name, input = {}) {
  const verb = TOOL_VERBS[name] || `Using ${name || "a tool"}`;
  const detail = toolDetail(input);
  return detail ? `${verb} ${detail}` : verb;
}

export function activityFor(state) {
  if (!state?.busy) return "";
  // Claude is waiting on the person, not working; the card says so.
  if (state.pendingQuestionId || state.pendingPermissionId) return "";
  if (state.thinking) return "Thinking";
  const cards = [...state.cards.values()];
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (card.type === "tool.started") return describeTool(card.payload.name, card.payload.input);
    if (card.type === "assistant.message" && (card.payload.text || "").length) return "Writing";
    if (card.type === "tool.completed") return "Working";
    if (card.type === "user.message") break;
  }
  return "Working";
}

function renderQuestionBody(card) {
  const questions = card.payload.questions || [];
  const readOnly = card.payload.readOnly === true;
  const disabled = card.entered || readOnly ? " disabled" : "";
  const blocks = questions.map((question, index) => {
    const name = `q${index}`;
    const options = question.options || [];
    const legend = question.header ? `<legend>${escapeHtml(question.header)}</legend>` : "";
    const text = `<p class="q-text">${escapeHtml(question.question || question.header || "")}</p>`;
    if (!options.length) {
      return `<fieldset class="q" data-question="${index}">${legend}${text}<textarea name="${name}" rows="3" placeholder="Type your answer"${disabled}></textarea></fieldset>`;
    }
    const type = question.multiSelect ? "checkbox" : "radio";
    const choices = options.map((option) => `<label class="q-option"><input type="${type}" name="${name}" value="${escapeHtml(option.label)}"${disabled}><span><strong>${escapeHtml(option.label)}</strong>${option.description ? `<em>${escapeHtml(option.description)}</em>` : ""}</span></label>`).join("");
    const hint = question.multiSelect ? `<p class="hint">Pick all that apply.</p>` : "";
    const other = `<label class="q-option q-other"><span>Something else</span><input type="text" name="${name}__other" placeholder="Type your own answer"${disabled}></label>`;
    return `<fieldset class="q" data-question="${index}">${legend}${text}${hint}${choices}${other}</fieldset>`;
  }).join("");
  if (readOnly) {
    // Nothing here can be clicked in print mode; list the choices plainly and
    // point at the message box.
    const list = questions.map((question) => {
      const options = (question.options || []).map((option) => `<li><strong>${escapeHtml(option.label)}</strong>${option.description ? `<em>${escapeHtml(option.description)}</em>` : ""}</li>`).join("");
      return `<p class="q-text">${escapeHtml(question.question || question.header || "")}</p>${options ? `<ol class="q-list">${options}</ol>` : ""}`;
    }).join("");
    return `<div class="interaction" data-kind="question-readonly" data-id="${escapeHtml(card.id)}"><p>Claude has a question.</p>${list}<p class="hint">Claude will repeat this question in a moment. Answer it then in the message box at the bottom, for example with the name of the option you want.</p></div>`;
  }
  const footer = card.entered
    ? `<p class="hint">${card.payload.answered === false ? (card.payload.reason === "timeout" ? "No answer within five minutes, so Claude went on without one." : "Not answered.") : "Answered."}</p>`
    : `<p class="form-error" role="alert" hidden></p><button type="submit">Send answers</button>`;
  return `<form class="interaction" data-kind="question" data-id="${escapeHtml(card.id)}">${blocks}${footer}</form>`;
}

function renderPermissionBody(card) {
  const disabled = card.entered ? " disabled" : "";
  const name = card.payload.displayName || card.payload.toolName || "A tool";
  const title = card.payload.title || `Claude wants to use ${name}.`;
  const detail = describeTool(card.payload.toolName, card.payload.input || {});
  const description = card.payload.description ? `<p class="hint">${escapeHtml(card.payload.description)}</p>` : "";
  const suggestions = Array.isArray(card.payload.suggestions) ? card.payload.suggestions : [];
  const persistent = suggestions.some((item) => item?.destination === "localSettings" || item?.destination === "projectSettings");
  const scoped = suggestions.length
    ? `<button type="button" data-decision="allow-scoped"${disabled}>${persistent ? "Allow in this folder from now on" : "Allow for the rest of this chat"}</button>`
    : "";
  const outcome = card.entered
    ? `<p class="hint">${card.payload.decision === "deny" ? (card.payload.reason === "timeout" ? "No answer within five minutes, so Claude went on without it." : "Not allowed.") : "Allowed."}</p>`
    : "";
  return `<div class="interaction" data-kind="permission" data-id="${escapeHtml(card.id)}">
    <p>${escapeHtml(title)}</p>
    ${detail && !card.payload.title ? `<p class="tool done">${escapeHtml(detail)}</p>` : ""}
    ${description}
    <div class="sheet-actions">
      <button type="button" data-decision="allow-once"${disabled}>Allow once</button>
      ${scoped}
      <button type="button" data-decision="deny" class="ghost"${disabled}>Don't allow</button>
    </div>
    ${outcome}
  </div>`;
}

function renderAutofillBody(card) {
  const disabled = card.entered ? " disabled" : "";
  const rawUrl = card.payload.url || "";
  const url = rawUrl
    ? (/^(https?:|mailto:)/i.test(rawUrl)
      ? `<p><a href="${escapeHtml(rawUrl)}" target="_blank" rel="noreferrer">${escapeHtml(rawUrl)}</a></p>`
      : `<p>${escapeHtml(rawUrl)}</p>`)
    : "";
  const shot = card.payload.screenshot ? `<p class="hint">Screenshot saved at ${escapeHtml(card.payload.screenshot)}</p>` : "";
  return `<div class="interaction" data-kind="autofill" data-id="${escapeHtml(card.id)}" data-token="${escapeHtml(card.payload.token || "")}">
    <p>Claude filled in the application form but did not send it. Open the form in your browser, check every field, and click the employer's own Submit button yourself. Then press Done here so Claude can log it, or Cancel to abandon this application.</p>
    ${url}
    ${shot}
    <div class="sheet-actions">
      <button type="button" data-decision="continue"${disabled}>Done, I submitted it</button>
      <button type="button" data-decision="cancel" class="ghost"${disabled}>Cancel</button>
    </div>
  </div>`;
}

function bodyHtml(card, { markdown } = {}) {
  if (card.type === "question.requested") return renderQuestionBody(card);
  if (card.type === "permission.requested") return renderPermissionBody(card);
  if (card.type === "autofill.review" || card.type === "autofill.resolved") return renderAutofillBody(card);
  if (card.type.startsWith("tool")) {
    const phase = card.type === "tool.completed" ? "done" : "live";
    const label = describeTool(card.payload.name, card.payload.input);
    return `<p class="tool ${phase}" title="${escapeHtml(card.payload.name || "tool")}">${escapeHtml(label)}</p>`;
  }
  if (card.type === "artifact.discovered") {
    return `<p class="tool done">Saved ${escapeHtml(card.payload.relativePath || "a file")}</p>`;
  }
  const text = card.payload.text || card.payload.reason || "";
  if (card.type === "turn.failed" && card.payload.detail) {
    return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p><details><summary>Technical details</summary><pre>${escapeHtml(card.payload.detail)}</pre></details>`;
  }
  if (card.type === "subagent.activity") {
    const label = card.payload.subagentType ? `${card.payload.subagentType} agent` : "Helper agent";
    const body = markdown ? markdown(text) : `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
    return `<details class="subagent"><summary>${escapeHtml(label)} notes</summary>${body}</details>`;
  }
  if (markdown && card.type === "assistant.message") {
    return markdown(text);
  }
  return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

function signatureFor(card) {
  const text = card.payload.text || "";
  return [
    card.type,
    card.entered ? "1" : "0",
    card.payload.phase || "",
    card.payload.decision || "",
    card.type.startsWith("tool") ? describeTool(card.payload.name, card.payload.input) : "",
    text.length,
    text.slice(-24),
    card.payload.questions ? JSON.stringify(card.payload.questions).length : 0,
  ].join("|");
}

function paintCard(article, card, options) {
  // Keep the entrance class across repaints: dropping it mid-animation would
  // snap a card that is still fading in.
  article.className = `${cardClass(card)}${article.classList.contains("enter") ? " enter" : ""}`;
  article.dataset.cardType = card.type;
  if (card.entered) article.dataset.entered = "true";
  else delete article.dataset.entered;
  article.dataset.sig = signatureFor(card);
  const body = article.querySelector(":scope > .body");
  body.innerHTML = bodyHtml(card, options);
}

// Keyed reconciliation: an article per card id, updated in place. Rebuilding
// the whole log on every streamed token restarted every card's entrance
// animation (the "pulse") and fired a scroll event that undid the reader's
// scroll position.
export function renderChat(container, state, options = {}) {
  const document = container.ownerDocument;
  if (!state.cards.size && !state.queued.length) {
    container.replaceChildren();
    container.insertAdjacentHTML("afterbegin", options.emptyHtml || "");
    return;
  }

  const existing = new Map();
  for (const node of [...container.children]) {
    if (node.tagName === "ARTICLE" && node.dataset.cardId) existing.set(node.dataset.cardId, node);
    else node.remove();
  }

  let cursor = container.firstElementChild;
  for (const card of state.cards.values()) {
    let article = existing.get(card.id);
    if (article) {
      existing.delete(card.id);
      if (article.dataset.sig !== signatureFor(card)) paintCard(article, card, options);
    } else {
      article = document.createElement("article");
      article.dataset.cardId = card.id;
      article.innerHTML = `<div class="msg-head"><div class="who"></div></div><div class="body"></div>`;
      paintCard(article, card, options);
      article.classList.add("enter");
    }
    article.querySelector(":scope > .msg-head > .who").textContent = whoFor(card.type);
    if (article !== cursor) container.insertBefore(article, cursor);
    else cursor = cursor.nextElementSibling;
  }
  for (const stale of existing.values()) stale.remove();
  while (cursor) {
    const next = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }

  if (state.queued.length) {
    const queue = document.createElement("div");
    queue.className = "queue";
    queue.setAttribute("aria-label", "Queued messages");
    queue.innerHTML = `<p class="kicker">Next up</p>${state.queued.map((item) => `<p data-queue-id="${escapeHtml(item.id)}">${escapeHtml(item.text)}</p>`).join("")}`;
    container.append(queue);
  }

  const activity = activityFor(state);
  if (activity) {
    const row = document.createElement("div");
    row.className = "activity";
    row.setAttribute("aria-hidden", "true");
    row.dataset.activity = activity;
    row.innerHTML = `<span class="activity-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="activity-text">${escapeHtml(activity)}…</span>`;
    container.append(row);
  }
}

export function renderPaletteList(container, commands) {
  container.replaceChildren();
  for (const command of commands) {
    const button = container.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "palette-item";
    button.dataset.command = command.id;
    button.innerHTML = `<strong>${escapeHtml(command.title)}</strong><em>${escapeHtml(command.invocation)}</em>`;
    container.append(button);
  }
}

export function renderSidebar(container, commands) {
  container.replaceChildren();
  primaryCommands(commands).forEach((command, index) => {
    const button = container.ownerDocument.createElement("button");
    button.type = "button";
    button.dataset.action = command.id;
    button.innerHTML = `<span class="n">${String(index + 1).padStart(2, "0")}</span><span><strong>${escapeHtml(command.title)}</strong><em>${escapeHtml(command.description || command.invocation)}</em></span>`;
    container.append(button);
  });
}
