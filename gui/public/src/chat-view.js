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

export function renderCommandInvocation(command, values = {}) {
  const parts = [command.invocation];
  let multiline = "";
  for (const argument of command.arguments || []) {
    const value = values[argument.name];
    if (value == null || value === "" || value === false) continue;
    if (argument.kind === "boolean") {
      parts.push(argument.flag.startsWith("--") ? argument.flag : `--${argument.flag}`);
      continue;
    }
    if (argument.kind === "multiline") {
      multiline = String(value);
      continue;
    }
    if (argument.flag) {
      parts.push(argument.flag.startsWith("--") ? argument.flag : `--${argument.flag}`, String(value));
      continue;
    }
    parts.push(String(value));
  }
  const rendered = parts.join(" ").trim();
  return multiline ? `${rendered}\n${multiline}` : rendered;
}

export function renderCommandForm(command) {
  const fields = (command.arguments || []).map((argument) => {
    const name = escapeHtml(argument.name);
    if (argument.kind === "choice") {
      const options = (argument.values || []).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
      return `<label data-arg="${name}"><span>${name}</span><select name="${name}">${options}</select></label>`;
    }
    if (argument.kind === "boolean") {
      return `<label class="check" data-arg="${name}"><input type="checkbox" name="${name}"> ${name}</label>`;
    }
    if (argument.kind === "multiline") {
      return `<label data-arg="${name}"><span>${name}</span><textarea name="${name}" rows="8"></textarea></label>`;
    }
    const type = argument.kind === "url" ? "url" : argument.kind === "integer" ? "number" : "text";
    return `<label data-arg="${name}"><span>${name}</span><input name="${name}" type="${type}"></label>`;
  });
  return fields.join("");
}

export function valuesFromForm(form) {
  const values = {};
  for (const field of form.querySelectorAll("[name]")) {
    if (field.type === "checkbox") values[field.name] = field.checked;
    else values[field.name] = field.value;
  }
  return values;
}

function whoFor(type) {
  if (type === "user.message") return "You";
  if (type === "turn.failed" || type === "diagnostic.unknown_sdk_event") return "Stopped";
  if (type.startsWith("question") || type.startsWith("permission") || type.startsWith("autofill")) return "Needs you";
  return "Claude";
}

function cardClass(card) {
  if (card.type === "user.message") return "msg user";
  if (card.type === "turn.failed") return "msg error";
  if (card.type.startsWith("tool")) return "msg assistant card-tool";
  if (card.type.startsWith("question")) return "msg assistant card-question";
  if (card.type.startsWith("permission")) return "msg assistant card-permission";
  if (card.type.startsWith("autofill")) return "msg assistant card-autofill";
  return "msg assistant";
}

function renderQuestionBody(card) {
  const questions = card.payload.questions || [];
  const disabled = card.entered ? " disabled" : "";
  const fields = questions.map((question, index) => {
    const key = question.header || question.question || `q${index}`;
    const options = question.options || [];
    if (!options.length) {
      return `<label><span>${escapeHtml(question.question || key)}</span><textarea name="${escapeHtml(key)}"${disabled}></textarea></label>`;
    }
    const multiple = question.multiSelect ? " multiple" : "";
    const choices = options.map((option) => `<option value="${escapeHtml(option.label)}">${escapeHtml(option.label)}</option>`).join("");
    return `<label><span>${escapeHtml(question.question || key)}</span><select name="${escapeHtml(key)}"${multiple}${disabled}>${choices}</select></label>`;
  }).join("");
  return `<form class="interaction" data-kind="question" data-id="${escapeHtml(card.id)}">${fields}<button type="submit"${disabled}>Answer</button></form>`;
}

function renderPermissionBody(card) {
  const disabled = card.entered ? " disabled" : "";
  const scoped = Array.isArray(card.payload.suggestions) && card.payload.suggestions.length
    ? `<button type="button" data-decision="allow-scoped"${disabled}>Allow for workspace</button>`
    : "";
  return `<div class="interaction" data-kind="permission" data-id="${escapeHtml(card.id)}">
    <p>${escapeHtml(card.payload.toolName || "Tool")} needs approval.</p>
    <div class="sheet-actions">
      <button type="button" data-decision="allow-once"${disabled}>Allow once</button>
      ${scoped}
      <button type="button" data-decision="deny" class="ghost"${disabled}>Deny</button>
    </div>
  </div>`;
}

function renderAutofillBody(card) {
  const disabled = card.entered ? " disabled" : "";
  const url = card.payload.url ? `<p><a href="${escapeHtml(card.payload.url)}" target="_blank" rel="noreferrer">${escapeHtml(card.payload.url)}</a></p>` : "";
  const shot = card.payload.screenshot ? `<p class="hint">Screenshot saved at ${escapeHtml(card.payload.screenshot)}</p>` : "";
  return `<div class="interaction" data-kind="autofill" data-id="${escapeHtml(card.id)}" data-token="${escapeHtml(card.payload.token || "")}">
    <p>The form is filled. Submit stays in the browser. Continue closes Autofill; Cancel stops it.</p>
    ${url}
    ${shot}
    <div class="sheet-actions">
      <button type="button" data-decision="continue"${disabled}>Continue</button>
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
    return `<p class="tool ${phase}">${escapeHtml(card.payload.name || "tool")} ${phase === "done" ? "done" : ""}</p>`;
  }
  const text = card.payload.text || card.payload.reason || "";
  if (markdown && (card.type === "assistant.message" || card.type === "turn.completed")) {
    return markdown(text);
  }
  return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

export function renderChat(container, state, options = {}) {
  const document = container.ownerDocument;
  container.replaceChildren();
  if (!state.cards.size && !state.queued.length) {
    container.insertAdjacentHTML("afterbegin", options.emptyHtml || "");
    return;
  }
  for (const card of state.cards.values()) {
    const article = document.createElement("article");
    article.className = cardClass(card);
    article.dataset.cardId = card.id;
    article.dataset.cardType = card.type;
    if (card.entered) article.dataset.entered = "true";
    article.innerHTML = `
      <div class="msg-head">
        <div class="who">${escapeHtml(whoFor(card.type))}</div>
      </div>
      <div class="body">${bodyHtml(card, options)}</div>
    `;
    container.append(article);
  }
  if (state.queued.length) {
    const queue = document.createElement("div");
    queue.className = "queue";
    queue.setAttribute("aria-label", "Queued messages");
    queue.innerHTML = state.queued.map((item) => `<p data-queue-id="${escapeHtml(item.id)}">${escapeHtml(item.text)}</p>`).join("");
    container.append(queue);
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
