// The desk's non-conversation surfaces: the jobs the scraper found, the
// applications in the tracker, the first-run checklist, and the tools check.
// Pure rendering from server data; the page wires the buttons.

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export const JOB_FILTERS = [
  { id: "open", label: "To look at" },
  { id: "interested", label: "Interested" },
  { id: "applied", label: "Applied" },
  { id: "ignored", label: "Ignored" },
  { id: "all", label: "All" },
];

export function filterJobs(jobs, filter = "open", query = "") {
  const needle = String(query || "").trim().toLowerCase();
  return (jobs || []).filter((job) => {
    if (filter === "open" && job.bucket !== "new" && job.bucket !== "interested") return false;
    if (filter !== "open" && filter !== "all" && job.bucket !== filter) return false;
    if (!needle) return true;
    return [job.title, job.company, job.location, job.portal].filter(Boolean).join(" ").toLowerCase().includes(needle);
  });
}

function countBuckets(jobs) {
  const counts = { open: 0, interested: 0, applied: 0, ignored: 0, all: jobs.length };
  for (const job of jobs) {
    if (job.bucket === "new" || job.bucket === "interested") counts.open += 1;
    if (counts[job.bucket] != null && job.bucket !== "new") counts[job.bucket] += 1;
  }
  return counts;
}

function rankBadge(job) {
  if (job.rankScore == null) return job.fit ? `<span class="pill">${escapeHtml(job.fit)} fit</span>` : "";
  const band = job.rankScore >= 75 ? "good" : job.rankScore >= 50 ? "mid" : "low";
  return `<span class="pill pill-${band}" title="${escapeHtml(job.rankVerdict || "Fit score from Rank")}">${escapeHtml(String(job.rankScore))} / 100${job.rankVerdict ? ` · ${escapeHtml(job.rankVerdict)}` : ""}</span>`;
}

function jobMeta(job) {
  const bits = [job.company, job.location, job.portal ? `via ${job.portal}` : "", job.firstSeen ? `found ${job.firstSeen}` : ""].filter(Boolean);
  return bits.map(escapeHtml).join(" · ");
}

export function renderJobs(container, { jobs = [], filter = "open", query = "", status = "ready", error = "", sample = null } = {}) {
  const document = container.ownerDocument;
  container.replaceChildren();
  if (status === "loading") {
    container.innerHTML = `<div class="empty"><p class="kicker">Jobs</p><h2>Loading…</h2></div>`;
    return;
  }
  if (status === "error") {
    container.innerHTML = `<div class="empty"><p class="kicker">Jobs</p><h2>Could not load the jobs.</h2><p>${escapeHtml(error || "Try again.")}</p></div>`;
    return;
  }
  if (!jobs.length) {
    const practice = sample
      ? `<div class="job-list"><article class="job-row bucket-new sample" data-job-key="${escapeHtml(sample.key)}">
          <div class="job-head"><h3>${escapeHtml(sample.title || "Practice role")}</h3><span class="pill">Practice</span></div>
          <p class="job-meta">${escapeHtml([sample.company, sample.location].filter(Boolean).join(" · "))}</p>
          <p class="app-notes">Practice only. Draft a packet against this sample. Do not send it to anyone.</p>
          <div class="row-actions"><button type="button" data-job-action="apply">Practice apply</button></div>
        </article></div>`
      : "";
    container.innerHTML = `<div class="empty"><p class="kicker">Jobs</p><h2>No jobs found yet.</h2><p>Click <strong>Find Jobs</strong> in the left column and Claude searches the job boards for openings that match you. They show up here, ready to apply to. Or practice on a marked-fake posting first.</p><div class="empty-actions"><button type="button" data-action="scrape">Find jobs now</button>${sample ? `<button type="button" class="ghost" data-sample-job>Practice with a sample job</button>` : ""}</div></div>${practice}`;
    return;
  }
  const counts = countBuckets(jobs);
  const toolbar = document.createElement("div");
  toolbar.className = "list-toolbar";
  toolbar.innerHTML = `<div class="filters" role="tablist" aria-label="Show">${JOB_FILTERS.map((item) => `<button type="button" class="filter${item.id === filter ? " selected" : ""}" data-job-filter="${item.id}" aria-pressed="${item.id === filter}">${item.label} <span class="count">${counts[item.id] ?? 0}</span></button>`).join("")}</div>
    <label class="search"><span class="sr-only">Search jobs</span><input type="search" data-job-search placeholder="Search title, company, place" value="${escapeHtml(query)}"></label>`;
  container.append(toolbar);

  const shown = filterJobs(jobs, filter, query);
  const list = document.createElement("div");
  list.className = "job-list";
  if (!shown.length) {
    list.innerHTML = `<p class="list-empty">Nothing here${query ? " for that search" : ""}.</p>`;
  }
  for (const job of shown) {
    const row = document.createElement("article");
    row.className = `job-row bucket-${job.bucket}`;
    row.dataset.jobKey = job.key;
    const title = job.url
      ? `<a href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(job.title || "Untitled posting")}</a>`
      : escapeHtml(job.title || "Untitled posting");
    const notes = job.strengths.length || job.gaps.length
      ? `<details class="job-notes"><summary>Why this score</summary>${job.strengths.length ? `<p><strong>For you:</strong> ${job.strengths.map(escapeHtml).join(" · ")}</p>` : ""}${job.gaps.length ? `<p><strong>Gaps:</strong> ${job.gaps.map(escapeHtml).join(" · ")}</p>` : ""}</details>`
      : "";
    const applied = job.bucket === "applied" ? `<span class="pill pill-applied">Applied${job.applicationStatus ? ` · ${escapeHtml(job.applicationStatus)}` : ""}</span>` : "";
    const actions = job.bucket === "applied"
      ? ""
      : `<div class="row-actions">
          ${job.url ? `<button type="button" data-job-action="apply">Apply</button>` : `<button type="button" data-job-action="apply" title="No link was saved for this posting; Claude will ask you to paste it">Apply</button>`}
          ${job.url ? `<button type="button" class="ghost" data-job-action="autofill">Autofill</button>` : ""}
          ${job.bucket === "interested" ? `<button type="button" class="ghost" data-job-action="unmark">Not interested after all</button>` : job.bucket === "ignored" ? `<button type="button" class="ghost" data-job-action="unmark">Bring back</button>` : `<button type="button" class="ghost" data-job-action="interested">Interested</button><button type="button" class="ghost" data-job-action="ignore">Ignore</button>`}
        </div>`;
    row.innerHTML = `<div class="job-head"><h3>${title}</h3>${rankBadge(job)}${applied}</div><p class="job-meta">${jobMeta(job)}${job.deadline ? ` · <strong>deadline ${escapeHtml(job.deadline)}</strong>` : ""}</p>${notes}${actions}`;
    list.append(row);
  }
  container.append(list);
}

const STATUS_LABELS = {
  applied: "Applied",
  in_progress: "In progress",
  interview: "Interviewing",
  interviewing: "Interviewing",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  no_response: "No response",
  "no response": "No response",
  offer_declined: "Declined",
  "offer declined": "Declined",
  withdrawn: "Withdrawn",
  interview_only: "Interviewed",
};

export function statusLabel(status) {
  const key = String(status || "").toLowerCase().trim();
  return STATUS_LABELS[key] || (key ? key.replace(/_/g, " ") : "Unknown");
}

export function renderApplications(container, { applications = [], status = "ready", error = "", preview = null } = {}) {
  const document = container.ownerDocument;
  container.replaceChildren();
  if (status === "loading") {
    container.innerHTML = `<div class="empty"><p class="kicker">Applications</p><h2>Loading…</h2></div>`;
    return;
  }
  if (status === "error") {
    container.innerHTML = `<div class="empty"><p class="kicker">Applications</p><h2>Could not load your applications.</h2><p>${escapeHtml(error || "Try again.")}</p></div>`;
    return;
  }
  if (!applications.length) {
    container.innerHTML = `<div class="empty"><p class="kicker">Applications</p><h2>Nothing applied to yet.</h2><p>When you apply to a job, Claude records it here with its CV, cover letter, and what happened next.</p></div>`;
    return;
  }
  const list = document.createElement("div");
  list.className = "app-list";
  const sorted = [...applications].sort((left, right) => String(right.date).localeCompare(String(left.date)));
  for (const app of sorted) {
    const row = document.createElement("article");
    row.className = `app-row${app.open ? " open" : ""}`;
    row.dataset.appId = app.id;
    row.dataset.company = app.company;
    row.dataset.role = app.role;
    const files = [
      app.cvFile ? `<button type="button" class="ghost" data-file="${escapeHtml(app.cvFile)}">CV</button>` : "",
      app.coverLetterFile ? `<button type="button" class="ghost" data-file="${escapeHtml(app.coverLetterFile)}">Cover letter</button>` : "",
      app.archive ? `<button type="button" class="ghost" data-reveal="${escapeHtml(app.archive)}">Show folder</button>` : "",
    ].filter(Boolean).join("");
    row.innerHTML = `<div class="job-head"><h3>${escapeHtml(app.company || "Unknown company")} · ${escapeHtml(app.role || "role")}</h3><span class="pill${app.open ? " pill-open" : ""}">${escapeHtml(statusLabel(app.status))}</span></div>
      <p class="job-meta">${[app.date ? `applied ${app.date}` : "", app.channel, app.fit ? `fit ${app.fit}` : "", app.deadline ? `<strong>deadline ${escapeHtml(app.deadline)}</strong>` : ""].filter(Boolean).map((bit) => bit.startsWith("<strong>") ? bit : escapeHtml(bit)).join(" · ")}</p>
      ${app.notes ? `<p class="app-notes">${escapeHtml(app.notes)}</p>` : ""}
      <div class="row-actions">${files}<button type="button" data-app-action="outcome">Record what happened</button><button type="button" class="ghost" data-app-action="interview">Prepare for interview</button></div>`;
    list.append(row);
  }
  container.append(list);
  if (preview) {
    const pane = document.createElement("div");
    pane.className = "file-preview";
    pane.innerHTML = `<div class="file-preview-head"><strong>${escapeHtml(preview.path)}</strong><button type="button" class="ghost" data-open-file="${escapeHtml(preview.path)}">Open in its usual app</button><button type="button" class="ghost" data-close-preview>Close</button></div>${preview.kind === "pdf" ? `<iframe class="artifact-pdf" src="${escapeHtml(preview.src)}" title="Preview"></iframe>` : `<pre class="artifact-text">${escapeHtml(preview.text || "")}</pre>`}`;
    container.append(pane);
  }
}

export function renderChecklist(progress, tools) {
  if (!progress?.steps?.length) return "";
  const items = progress.steps.map((step, index) => {
    const current = progress.next === step.id;
    return `<li class="${step.done ? "done" : current ? "current" : ""}"><span class="tick" aria-hidden="true">${step.done ? "✓" : index + 1}</span><div><strong>${escapeHtml(step.title)}</strong><em>${escapeHtml(step.hint)}</em>${current ? `<button type="button" data-checklist-action="${escapeHtml(step.action)}">${step.action === "documents" ? "Add files" : step.action === "scrape" ? "Find jobs" : step.action === "apply" ? "Pick a job" : "Start setup"}</button>` : ""}</div></li>`;
  }).join("");
  const missing = (tools?.tools || []).filter((tool) => !tool.installed && tool.requiredFor !== "optional" && tool.id !== "claude");
  const warning = missing.length
    ? `<p class="tools-warning">Some steps need tools this computer does not have yet: ${missing.map((tool) => escapeHtml(tool.name)).join(", ")}. <button type="button" class="link" data-open-tools>See what to install</button></p>`
    : "";
  return `<ol class="checklist" aria-label="Getting started">${items}</ol>${warning}`;
}

export function renderTools(container, info) {
  container.replaceChildren();
  if (!info?.tools) {
    container.innerHTML = `<p>Checking…</p>`;
    return;
  }
  const list = container.ownerDocument.createElement("ul");
  list.className = "tools-list";
  for (const tool of info.tools) {
    const item = container.ownerDocument.createElement("li");
    item.className = tool.installed ? "ok" : tool.requiredFor === "optional" ? "optional" : "missing";
    item.innerHTML = `<span class="tick" aria-hidden="true">${tool.installed ? "✓" : "✗"}</span><div><strong>${escapeHtml(tool.name)}</strong> <span class="pill">${tool.installed ? "installed" : tool.requiredFor === "optional" ? "optional, not installed" : `needed for ${escapeHtml(tool.requiredFor)}`}</span><em>${escapeHtml(tool.purpose)}</em>${tool.installed ? "" : `<p class="install">${escapeHtml(tool.install || "")}${tool.url ? ` <a href="${escapeHtml(tool.url)}" target="_blank" rel="noopener noreferrer">Download</a>` : ""}</p>`}</div>`;
    list.append(item);
  }
  container.append(list);
}
