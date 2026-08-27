/**
 * Application tracker.
 *
 * The board was previously inert: setupTrackerTab() was an empty function, so
 * cards could not move, Interviewing and Offer were unreachable, the delete
 * endpoint had no UI, and Rejected/Withdrawn fell back into Drafted. It now
 * supports drag between columns, a keyboard-accessible status control, notes,
 * follow-up dates, filtering, and a collapsed lane for closed outcomes.
 */
import { api } from './api.js';
import { $, escapeHtml, showToast, formatDate, relativeDays } from './ui.js';

const OPEN_COLUMNS = ['Drafted', 'Applied', 'Interviewing', 'Offer'];

export class Tracker {
  /** @param {{ onChange?: (app: any) => void }} [options] */
  constructor({ onChange } = {}) {
    this.onChange = onChange;
    this.applications = [];
    this.statuses = [...OPEN_COLUMNS, 'Rejected', 'Withdrawn'];
    this.closedStatuses = ['Rejected', 'Withdrawn'];
    this.dueFollowUps = new Set();
    this.filter = '';
    this.showOnlyDue = false;
  }

  init() {
    OPEN_COLUMNS.forEach(status => {
      const col = $(`col-${status}`);
      if (!col) return;

      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        if (id) await this.setStatus(id, status);
      });
    });

    const search = $('trackerSearch');
    if (search) {
      let debounce;
      search.addEventListener('input', (e) => {
        clearTimeout(debounce);
        const value = e.target.value;
        debounce = setTimeout(() => {
          this.filter = value;
          this.render();
        }, 180);
      });
    }

    const dueButton = $('btnShowDueFollowUps');
    dueButton?.addEventListener('click', () => {
      this.showOnlyDue = !this.showOnlyDue;
      dueButton.setAttribute('aria-pressed', String(this.showOnlyDue));
      dueButton.classList.toggle('active', this.showOnlyDue);
      this.render();
    });
  }

  async load() {
    try {
      const data = await api.get('/api/tracker');
      if (!data.success) return;

      this.applications = data.applications || [];
      this.statuses = data.statuses || this.statuses;
      this.closedStatuses = data.closedStatuses || this.closedStatuses;
      this.dueFollowUps = new Set(data.dueFollowUps || []);
      this.render();
    } catch (err) {
      if (err.status !== 401) showToast(err.message, 'error');
    }
  }

  visibleApplications() {
    const needle = this.filter.trim().toLowerCase();
    return this.applications.filter(app => {
      if (this.showOnlyDue && !this.dueFollowUps.has(app.id)) return false;
      if (!needle) return true;
      return [app.jobTitle, app.company, app.notes]
        .some(field => (field || '').toLowerCase().includes(needle));
    });
  }

  render() {
    const visible = this.visibleApplications();
    const counts = Object.fromEntries([...OPEN_COLUMNS, 'Closed'].map(s => [s, 0]));

    [...OPEN_COLUMNS, 'Closed'].forEach(status => {
      const col = $(`col-${status}`);
      if (col) col.innerHTML = '';
    });

    for (const app of visible) {
      const isClosed = this.closedStatuses.includes(app.status);
      const lane = isClosed ? 'Closed' : (OPEN_COLUMNS.includes(app.status) ? app.status : 'Drafted');
      counts[lane]++;

      const col = $(`col-${lane}`);
      if (col) col.appendChild(this.card(app, isClosed));
    }

    for (const [lane, count] of Object.entries(counts)) {
      const pill = $(`count-${lane}`);
      if (pill) pill.textContent = String(count);
    }

    const dueCount = $('countDueFollowUps');
    if (dueCount) dueCount.textContent = String(this.dueFollowUps.size);

    const closedLane = $('closedLane');
    if (closedLane) closedLane.classList.toggle('hidden', counts.Closed === 0);
  }

  card(app, isClosed) {
    const card = document.createElement('div');
    card.className = 'kanban-card' + (isClosed ? ' is-closed' : '');
    card.draggable = !isClosed;
    card.dataset.appId = app.id;

    const fit = typeof app.fitScore === 'number' ? `${app.fitScore}%` : 'not scored';
    const isDue = this.dueFollowUps.has(app.id);

    const followUpLabel = app.followUpAt
      ? `<span class="follow-up${isDue ? ' is-due' : ''}" title="Follow up ${formatDate(app.followUpAt)}">
           ${isDue ? 'Follow up ' : 'Follow-up '}${escapeHtml(relativeDays(app.followUpAt))}
         </span>`
      : '';

    card.innerHTML = `
      <div class="kanban-card-head">
        <h4>${escapeHtml(app.jobTitle || 'Role')}</h4>
        <button class="kanban-delete" aria-label="Delete application for ${escapeHtml(app.jobTitle || 'this role')}" title="Delete">&times;</button>
      </div>
      <div class="company">${escapeHtml(app.company || 'Company')}</div>
      <div class="kanban-meta">
        <span>Fit: ${escapeHtml(fit)}</span>
        <span>${escapeHtml(formatDate(app.createdAt))}</span>
      </div>
      ${followUpLabel}
      ${app.notes ? `<p class="kanban-notes">${escapeHtml(app.notes)}</p>` : ''}
      <div class="kanban-controls">
        <label class="visually-hidden" for="status-${app.id}">Status</label>
        <select class="kanban-status" id="status-${app.id}">
          ${this.statuses.map(s =>
            `<option value="${escapeHtml(s)}"${s === app.status ? ' selected' : ''}>${escapeHtml(s)}</option>`
          ).join('')}
        </select>
        <button class="btn-icon kanban-edit" aria-label="Edit notes and follow-up" title="Notes and follow-up">&#9998;</button>
      </div>`;

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', app.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));

    card.querySelector('.kanban-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      this.remove(app);
    });
    card.querySelector('.kanban-status').addEventListener('change', (e) => {
      this.setStatus(app.id, /** @type {HTMLSelectElement} */ (e.target).value);
    });
    card.querySelector('.kanban-edit').addEventListener('click', () => this.editDetails(app));

    return card;
  }

  async setStatus(id, status) {
    try {
      const data = await api.patch(`/api/tracker/${id}/status`, { status });
      if (data.success) {
        showToast(`Moved to ${status}.`, 'success');
        await this.load();
        this.onChange?.(data.application);
      }
    } catch (err) {
      if (err.status !== 401) showToast(err.message, 'error');
    }
  }

  async remove(app) {
    if (!window.confirm(`Delete the application for ${app.jobTitle || 'this role'}? This cannot be undone.`)) return;
    try {
      await api.del(`/api/tracker/${app.id}`);
      showToast('Application deleted.', 'success');
      await this.load();
      this.onChange?.(null);
    } catch (err) {
      if (err.status !== 401) showToast(err.message, 'error');
    }
  }

  /**
   * Notes and a follow-up date.
   * Uses prompts rather than a bespoke modal: it keeps the interaction
   * keyboard-accessible with no extra focus management, and the fields are
   * two short values.
   */
  async editDetails(app) {
    const notes = window.prompt('Notes for this application:', app.notes || '');
    if (notes === null) return;

    const current = app.followUpAt ? app.followUpAt.slice(0, 10) : '';
    const followUp = window.prompt('Follow up on (YYYY-MM-DD, blank to clear):', current);
    if (followUp === null) return;

    const trimmed = followUp.trim();
    let followUpAt = '';
    if (trimmed) {
      const parsed = new Date(`${trimmed}T09:00:00`);
      if (Number.isNaN(parsed.getTime())) {
        showToast('That date could not be read. Use YYYY-MM-DD.', 'error');
        return;
      }
      followUpAt = parsed.toISOString();
    }

    try {
      await api.patch(`/api/tracker/${app.id}`, { notes, followUpAt });
      showToast('Saved.', 'success');
      await this.load();
    } catch (err) {
      if (err.status !== 401) showToast(err.message, 'error');
    }
  }
}
