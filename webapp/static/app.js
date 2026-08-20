function showMessage(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.hidden = false;
}

async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || "Request failed");
  return body;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action], button.stage-action, button.review-action, button.confirm-pack, button.status-action");
  if (!button) return;
  button.disabled = true;
  try {
    if (button.dataset.action === "refresh-profile") {
      await api("/api/profile/refresh", {method: "POST"});
    } else if (button.classList.contains("stage-action")) {
      const extensionIds = [...document.querySelectorAll('input[name="extension_ids"]:checked')].map(item => item.value);
      const payload = {request_id: `web_${Date.now()}`};
      if (button.dataset.stage === "fit") payload.extension_ids = extensionIds;
      await api(`/api/workspaces/${button.dataset.workspaceId}/${button.dataset.stage}`, {
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)
      });
    } else if (button.classList.contains("review-action")) {
      await api(`/api/workspaces/${button.dataset.workspaceId}/review-decisions`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({review_item_type: button.dataset.itemType, source_artifact_id: button.dataset.artifactId,
          domain_item_id: button.dataset.itemId, disposition: button.dataset.disposition})
      });
    } else if (button.classList.contains("confirm-pack")) {
      if (!window.confirm("Create an immutable reviewed pack? This does not submit an application.")) {
        button.disabled = false;
        return;
      }
      const result = await api(`/api/workspaces/${button.dataset.workspaceId}/application-pack`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({confirmed: true, effective_date: new Date().toISOString().slice(0, 10)})
      });
      if (result.projection.status === "FAILED") {
        showMessage(`Pack created and status moved to drafted. Archive projection warning: ${result.projection.error.message}`, true);
        return;
      }
    } else if (button.classList.contains("status-action")) {
      if (button.dataset.status === "applied" && !window.confirm("Confirm that you submitted this application externally?")) {
        button.disabled = false;
        return;
      }
      await api(`/api/workspaces/${button.dataset.workspaceId}/status`, {
        method: "PATCH", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({new_status: button.dataset.status, effective_date: new Date().toISOString().slice(0, 10)})
      });
    }
    window.location.reload();
  } catch (error) {
    showMessage(error.message, true);
    button.disabled = false;
  }
});

const jobForm = document.getElementById("new-job-form");
if (jobForm) {
  jobForm.addEventListener("change", (event) => {
    if (event.target.name !== "mode") return;
    document.querySelectorAll("[data-mode-panel]").forEach(panel => {
      panel.hidden = panel.dataset.modePanel !== event.target.value;
    });
  });
  jobForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(jobForm);
    const company = data.get("company");
    const title = data.get("title");
    const mode = data.get("mode");
    try {
      let sourceRecord;
      if (mode === "import") {
        sourceRecord = JSON.parse(data.get("source_json"));
      } else {
        sourceRecord = {schema_version: "job-source-record.v0", source: mode === "paste" ? "manual-paste" : "manual",
          captured_at: new Date().toISOString(), company, title};
        if (mode === "paste") sourceRecord.raw_text = data.get("posting_text");
        else sourceRecord.description = data.get("description");
      }
      const result = await api("/api/workspaces", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({company, title, source_record: sourceRecord})});
      window.location.assign(`/workspaces/${result.workspace.id}`);
    } catch (error) { showMessage(error.message, true); }
  });
}
