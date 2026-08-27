window.Onboarding = (function () {
  let state = null; // {walkthroughId, definition, status, popoverEl, backdropEl, spotlightEl}

  async function apiCall(url, options) {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || "Onboarding request failed");
    return body;
  }

  async function start(walkthroughId) {
    const [definition, status] = await Promise.all([
      apiCall(`/api/onboarding/walkthroughs/${walkthroughId}/definition`),
      apiCall(`/api/onboarding/walkthroughs/${walkthroughId}`),
    ]);
    let nextEndpoint = "begin";
    if (status.status === "in_progress") nextEndpoint = "resume";
    else if (status.status === "completed" || status.status === "skipped") nextEndpoint = "replay";
    const opened = await apiCall(
      `/api/onboarding/walkthroughs/${walkthroughId}/${nextEndpoint}`, {method: "POST"}
    );
    _open(walkthroughId, definition, opened);
  }

  function _open(walkthroughId, definition, status) {
    state = {walkthroughId, definition, status};
    _buildDom();
    _renderStep();
  }

  function _buildDom() {
    const backdrop = document.createElement("div");
    backdrop.className = "onboarding-backdrop";
    const spotlight = document.createElement("div");
    spotlight.className = "onboarding-spotlight";
    const popover = document.createElement("div");
    popover.className = "onboarding-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-modal", "false");
    popover.setAttribute("aria-labelledby", "onboarding-popover-title");
    popover.setAttribute("aria-describedby", "onboarding-popover-body");
    popover.tabIndex = -1;
    document.body.appendChild(backdrop);
    document.body.appendChild(spotlight);
    document.body.appendChild(popover);
    state.backdropEl = backdrop;
    state.spotlightEl = spotlight;
    state.popoverEl = popover;
  }

  function _currentStep() {
    return state.definition.steps[state.status.current_step_index];
  }

  function _renderStep() {
    const step = _currentStep();
    const target = document.querySelector(step.target);
    if (!target) {
      _failStepGracefully();
      return;
    }
    const total = state.definition.steps.length;
    const index = state.status.current_step_index;
    state.popoverEl.innerHTML = `
      <button type="button" class="onboarding-popover-close" aria-label="Close walkthrough">&times;</button>
      <p class="onboarding-popover-progress">Step ${index + 1} of ${total}</p>
      <h2 class="onboarding-popover-title" id="onboarding-popover-title">${_escapeHtml(step.title)}</h2>
      <p class="onboarding-popover-body" id="onboarding-popover-body">${_escapeHtml(step.body)}</p>
      <div class="onboarding-popover-controls">
        <div class="onboarding-popover-controls-primary">
          ${index > 0 ? '<button type="button" class="button secondary" data-onboarding-action="back">Back</button>' : ""}
          <label class="onboarding-popover-dont-show"><input type="checkbox" data-onboarding-dont-show-again> Don't show this automatically again</label>
          <button type="button" class="button secondary" data-onboarding-action="skip">Skip</button>
        </div>
        <button type="button" class="button" data-onboarding-action="${index === total - 1 ? "finish" : "next"}">${index === total - 1 ? "Finish" : "Next"}</button>
      </div>`;
    target.scrollIntoView({block: "center", inline: "nearest"});
    _position(target, step.placement);
  }

  function _escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  function _position(target, placement) {
    const rect = target.getBoundingClientRect();
    const padding = 6;
    state.spotlightEl.style.top = `${rect.top - padding}px`;
    state.spotlightEl.style.left = `${rect.left - padding}px`;
    state.spotlightEl.style.width = `${rect.width + padding * 2}px`;
    state.spotlightEl.style.height = `${rect.height + padding * 2}px`;

    const popover = state.popoverEl;
    const popoverRect = popover.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    let resolvedPlacement = placement;
    if (placement === "auto" || !placement) {
      resolvedPlacement = (rect.bottom + popoverRect.height + 16 < viewportHeight) ? "bottom" : "top";
    }
    let top, left;
    if (resolvedPlacement === "bottom") {
      top = rect.bottom + 14;
      left = rect.left;
    } else if (resolvedPlacement === "top") {
      top = rect.top - popoverRect.height - 14;
      left = rect.left;
    } else if (resolvedPlacement === "left") {
      top = rect.top;
      left = rect.left - popoverRect.width - 14;
    } else {
      top = rect.top;
      left = rect.right + 14;
    }
    left = Math.max(12, Math.min(left, viewportWidth - popoverRect.width - 12));
    top = Math.max(12, Math.min(top, viewportHeight - popoverRect.height - 12));
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function _failStepGracefully() {
    // Real implementation added in Ticket 2 Task 4.
  }

  document.addEventListener("click", async (event) => {
    if (!state) return;
    const actionEl = event.target.closest("[data-onboarding-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.onboardingAction;
    try {
      if (action === "next") {
        state.status = await apiCall(
          `/api/onboarding/walkthroughs/${state.walkthroughId}/advance`, {method: "POST"}
        );
        _renderStep();
      } else if (action === "back") {
        state.status = await apiCall(
          `/api/onboarding/walkthroughs/${state.walkthroughId}/back`, {method: "POST"}
        );
        _renderStep();
      } else if (action === "finish") {
        await apiCall(
          `/api/onboarding/walkthroughs/${state.walkthroughId}/complete`, {method: "POST"}
        );
        _close();
      } else if (action === "skip") {
        const dontShowAgain = state.popoverEl.querySelector("[data-onboarding-dont-show-again]")?.checked;
        await apiCall(
          `/api/onboarding/walkthroughs/${state.walkthroughId}/skip`, {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({reason: dontShowAgain ? "dont_show_again" : "skip"}),
          }
        );
        _close();
      }
    } catch (error) {
      _close();
    }
  });

  document.addEventListener("click", (event) => {
    if (!state) return;
    if (event.target.closest(".onboarding-popover-close")) {
      _closeViaInterrupt();
    }
  });

  async function _closeViaInterrupt() {
    try {
      await apiCall(
        `/api/onboarding/walkthroughs/${state.walkthroughId}/interrupt`, {method: "POST"}
      );
    } finally {
      _close();
    }
  }

  function _close() {
    if (!state) return;
    state.backdropEl.remove();
    state.spotlightEl.remove();
    state.popoverEl.remove();
    state = null;
  }

  return {start};
})();
