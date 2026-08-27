/** Shared UI helpers: DOM access, escaping, toasts, tabs, focus management. */

/**
 * Element lookup.
 *
 * Typed loosely on purpose: these return whatever element the id names, and
 * annotating every call site with a concrete cast would add noise without
 * catching anything the checker does not already find elsewhere.
 *
 * @param {string} id
 * @returns {any}
 */
export const $ = (id) => document.getElementById(id);

/**
 * @param {string} selector
 * @returns {any[]}
 */
export const $$ = (selector) => Array.from(document.querySelectorAll(selector));

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function showToast(message, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  container.appendChild(toast);

  // Warnings and errors deserve longer on screen than a success ping.
  const ttl = type === 'error' || type === 'warning' ? 7000 : 3500;
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, ttl);
}

/**
 * Tabs with real ARIA semantics and arrow-key navigation.
 * They were plain buttons with a class toggle, which screen readers and
 * keyboard users could not interpret as a tab set.
 */
export function setupTabs(onChange) {
  const tabs = $$('.nav-tab');

  const activate = (tabId, focus = false) => {
    tabs.forEach(tab => {
      const selected = tab.dataset.tab === tabId;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    $$('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });
    onChange?.(tabId);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      activate(next.dataset.tab, true);
    });
  });

  return activate;
}

/**
 * Trap Tab within a modal and restore focus on close.
 * The login overlay previously let Tab wander into the page behind it.
 */
export function trapFocus(container) {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const previouslyFocused = document.activeElement;

  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(container.querySelectorAll(selector))
      .filter(el => el.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKeyDown);

  return function release() {
    container.removeEventListener('keydown', onKeyDown);
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  };
}

/** Format an ISO timestamp as a short local date, or '' when absent. */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** "in 3 days" / "2 days ago", for follow-up dates. */
export function relativeDays(iso) {
  if (!iso) return '';
  const diffMs = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return '';

  const days = Math.round(diffMs / 86_400_000);
  if (days === 0) return 'today';
  if (days > 0) return days === 1 ? 'tomorrow' : `in ${days} days`;
  return days === -1 ? 'yesterday' : `${Math.abs(days)} days ago`;
}
