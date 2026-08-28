window.Onboarding = (function () {
  let state = null; // {walkthroughId, definition, status, popoverEl, backdropEl, spotlightEl}
  let previouslyFocusedEl = null;
  let openedAutomatically = false;

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
    previouslyFocusedEl = document.activeElement;
    _buildDom();
    _renderStep();
    // _renderStep() may have already failed gracefully (missing target),
    // which tears everything down and sets state back to null -- bail out
    // rather than touch DOM nodes that no longer exist.
    if (!state) return;
    state.popoverEl.focus();
    document.addEventListener("keydown", _handleKeydown);
    window.addEventListener("resize", _handleReflow);
    window.addEventListener("scroll", _handleReflow, true);
  }

  function _handleKeydown(event) {
    if (!state) return;
    if (event.key === "Escape") {
      event.preventDefault();
      _closeViaInterrupt();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [...state.popoverEl.querySelectorAll("button")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
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
      ${openedAutomatically ? `
      <details class="onboarding-why-seeing-this">
        <summary>Why am I seeing this?</summary>
        <p>This is a first-use guide for this feature. You can skip it any
        time. Once you finish or skip it, it won't interrupt you again --
        you can always replay it later from Help &rarr; Walkthroughs.</p>
      </details>` : ""}
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
    const walkthroughId = state.walkthroughId;
    _teardownDom();
    state = null;
    openedAutomatically = false;
    apiCall(`/api/onboarding/walkthroughs/${walkthroughId}/interrupt`, {method: "POST"})
      .catch(() => {});
    _showFailNotice();
  }

  function _teardownDom() {
    document.removeEventListener("keydown", _handleKeydown);
    window.removeEventListener("resize", _handleReflow);
    window.removeEventListener("scroll", _handleReflow, true);
    if (state.backdropEl) state.backdropEl.remove();
    if (state.spotlightEl) state.spotlightEl.remove();
    if (state.popoverEl) state.popoverEl.remove();
  }

  function _showFailNotice() {
    const notice = document.createElement("div");
    notice.className = "onboarding-fail-notice";
    notice.setAttribute("role", "status");
    notice.innerHTML = 'This walkthrough step is unavailable right now. <button type="button">Dismiss</button>';
    notice.querySelector("button").addEventListener("click", () => notice.remove());
    document.body.appendChild(notice);
    if (previouslyFocusedEl && document.body.contains(previouslyFocusedEl)) {
      previouslyFocusedEl.focus();
    }
    previouslyFocusedEl = null;
  }

  let reflowScheduled = false;
  function _handleReflow() {
    if (!state || reflowScheduled) return;
    reflowScheduled = true;
    requestAnimationFrame(() => {
      reflowScheduled = false;
      if (!state) return;
      const step = _currentStep();
      const target = document.querySelector(step.target);
      if (!target) {
        _failStepGracefully();
        return;
      }
      _position(target, step.placement);
    });
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-onboarding-start]");
    if (!trigger) return;
    start(trigger.dataset.onboardingStart);
  });

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
    _teardownDom();
    const restoreTarget = previouslyFocusedEl;
    state = null;
    previouslyFocusedEl = null;
    openedAutomatically = false;
    if (restoreTarget && document.body.contains(restoreTarget)) {
      restoreTarget.focus();
    }
  }

  function _consumeReplayParam() {
    const params = new URLSearchParams(window.location.search);
    const replayId = params.get("onboarding_replay");
    if (!replayId) return null;
    const url = new URL(window.location.href);
    url.searchParams.delete("onboarding_replay");
    window.history.replaceState({}, "", url.toString());
    return replayId;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const replayId = _consumeReplayParam();
    if (replayId) {
      const validReplayId = document.body.dataset.onboardingValidReplay;
      if (replayId === validReplayId) {
        start(replayId);
      }
      // An id present but not valid for this page fails closed silently
      // -- the parameter is already stripped above, so a reload will not
      // retry it, and no walkthrough starts on a page it wasn't authored
      // for.
      return;
    }

    const autotriggerId = document.body.dataset.onboardingAutotrigger;
    if (!autotriggerId) return;
    apiCall(`/api/onboarding/walkthroughs/${autotriggerId}`)
      .then((status) => {
        if (status.status !== "not_started") return;
        openedAutomatically = true;
        return start(autotriggerId);
      })
      .catch(() => {
        // A failed status fetch must never block the page -- silently
        // skip auto-triggering rather than surface an error the user
        // did not ask to see.
      });
  });

  function appendReplayParamToLinks(selector) {
    const params = new URLSearchParams(window.location.search);
    const replayId = params.get("onboarding_replay");
    if (!replayId) return;
    document.querySelectorAll(selector).forEach((link) => {
      const url = new URL(link.href, window.location.href);
      url.searchParams.set("onboarding_replay", replayId);
      link.href = url.toString();
    });
  }

  return {start, appendReplayParamToLinks};
})();
