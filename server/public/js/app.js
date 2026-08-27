/**
 * AI Job Search - application shell.
 *
 * Wires the feature modules together and owns the screens that do not warrant
 * a module of their own (profile, job board, apply, interview prep).
 */
import { auth, api, onUnauthorized, postEventStream, downloadFile } from './api.js';
import { $, escapeHtml, showToast, setupTabs, trapFocus, formatDate } from './ui.js';
import { Onboarding } from './onboarding.js';
import { Tracker } from './tracker.js';
import { LatexEditor } from './editor.js';

const state = {
  profile: null,
  currentJob: null,
  currentFitEvaluation: null,
  currentApplication: null,
  activeDocType: 'cv',
  isLatexView: false,
  cvPdfBase64: null,
  coverPdfBase64: null,
  cvLatex: '',
  coverLatex: '',
  allSearchResults: [],
  currentPage: 1,
  pageSize: 12,
  portals: [],
  detailAvailable: false,
  activePdfObjectUrl: null,
  generationSource: ''
};

let switchTab;
let tracker;
let editor;
let releaseLoginFocus = null;

// ==========================================================================
// Auth shell
// ==========================================================================

function showLoginModal(message = '') {
  const overlay = $('loginOverlay');
  if (message) {
    $('loginError').textContent = message;
    $('loginError').classList.remove('hidden');
  }
  overlay.classList.remove('hidden');
  releaseLoginFocus ||= trapFocus(overlay);
  $('loginPasswordInput').focus();
}

function hideLoginModal() {
  $('loginOverlay').classList.add('hidden');
  releaseLoginFocus?.();
  releaseLoginFocus = null;
}

onUnauthorized.handler = () => showLoginModal('Session expired. Please unlock again.');

function setupAuth() {
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('loginPasswordInput').value;
    if (!password) return;

    const submitBtn = $('btnLoginSubmit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Verifying...';
    $('loginError').classList.add('hidden');

    try {
      const data = await api.public('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (data.success && data.token) {
        auth.set(data.token, data.expiresAt);
        hideLoginModal();
        $('loginPasswordInput').value = '';
        showToast('Workspace unlocked.', 'success');
        await afterLogin();
      } else {
        $('loginError').textContent = data.error || 'Incorrect password.';
        $('loginError').classList.remove('hidden');
      }
    } catch (err) {
      $('loginError').textContent = err.message || 'Connection error.';
      $('loginError').classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Unlock Workspace</span>';
    }
  });

  $('btnLogout').addEventListener('click', () => {
    auth.clear();
    showLoginModal('Workspace locked.');
  });
}

// ==========================================================================
// Startup
// ==========================================================================

async function init() {
  auth.load();

  setupAuth();
  switchTab = setupTabs();
  setupProfileTab();
  setupSearchTab();
  setupApplyTab();
  setupInterviewTab();

  tracker = new Tracker({
    onChange: (app) => {
      if (app && state.currentApplication?.id === app.id) state.currentApplication = app;
      if (!app && state.currentApplication) state.currentApplication = null;
      updateDocumentPreview();
    }
  });
  tracker.init();

  editor = new LatexEditor($('latexSourceTextarea'));

  await checkHealth();
  await loadPortals();

  if (!auth.token) {
    showLoginModal();
    return;
  }

  // Verify before rendering, so an invalid token shows the lock screen rather
  // than a burst of failing requests behind it.
  try {
    const res = await fetch('/api/auth/verify', { headers: { Authorization: `Bearer ${auth.token}` } });
    if (!res.ok) {
      auth.clear();
      showLoginModal('Session expired. Please unlock again.');
      return;
    }
  } catch {
    showToast('Could not reach the server.', 'error');
  }

  hideLoginModal();
  await afterLogin();
}

async function afterLogin() {
  await loadProfile();
  await tracker.load();

  if (!state.profile?.onboardingComplete && !hasAnyProfileData(state.profile)) {
    new Onboarding({
      portals: state.portals,
      onComplete: (profile) => {
        state.profile = profile;
        populateProfileForm(profile);
        seedSearchFromProfile(profile);
        switchTab('search');
      }
    }).start();
  }
}

function hasAnyProfileData(profile) {
  if (!profile) return false;
  const identity = profile.identity || {};
  return Boolean(identity.name || identity.email || (profile.skills?.primary || []).length);
}

async function checkHealth() {
  const badge = $('aiStatusBadge');
  const text = $('aiStatusText');
  try {
    const data = await api.public('/api/health');
    if (data.aiConfigured) {
      badge.className = 'status-pill connected';
      text.textContent = data.provider || 'AI engine ready';
      badge.title = `Provider: ${data.provider}`;
    } else {
      badge.className = 'status-pill warning';
      text.textContent = 'No AI provider';
      badge.title = 'Set an API key in server/.env. Evaluation and drafting will report themselves unavailable until then.';
    }
  } catch {
    badge.className = 'status-pill warning';
    text.textContent = 'Server unreachable';
  }
}

/** Build the portal dropdown from what the server can actually run. */
async function loadPortals() {
  try {
    const data = await api.public('/api/scrape/portals');
    if (!data.success || !data.portals?.length) return;

    state.portals = data.portals;
    state.detailAvailable = data.detailAvailable;

    const select = $('searchPortal');
    if (select) {
      select.innerHTML = data.portals
        .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
        .join('');
    }
  } catch {
    // Leave the markup's own options in place if the call fails.
  }
}

function seedSearchFromProfile(profile) {
  const target = profile?.targetQueries?.[0];
  if (!target) return;
  if (target.query) $('searchQuery').value = target.query;
  if (target.location) $('searchLocation').value = target.location;
  if (target.portal) $('searchPortal').value = target.portal;
}

// ==========================================================================
// Profile
// ==========================================================================

async function loadProfile() {
  try {
    const data = await api.get('/api/profile');
    if (data.success && data.profile) {
      state.profile = data.profile;
      populateProfileForm(data.profile);
      seedSearchFromProfile(data.profile);
    }
  } catch (err) {
    if (err.status !== 401) showToast('Could not load your profile.', 'error');
  }
}

function populateProfileForm(p) {
  if (!p) return;
  const identity = p.identity || {};
  const setVal = (id, val) => { const el = $(id); if (el) el.value = val || ''; };

  setVal('profName', identity.name);
  setVal('profTitle', identity.title);
  setVal('profEmail', identity.email);
  setVal('profPhone', identity.phone);
  setVal('profLocation', identity.location);
  setVal('profLinkedin', identity.linkedin);
  setVal('profSummary', identity.summary);

  const join = (v) => (Array.isArray(v) ? v.join(', ') : (v || ''));
  setVal('profPrimarySkills', join(p.skills?.primary));
  setVal('profSecondarySkills', join(p.skills?.secondary));

  setVal('profLanguages', (identity.languages || [])
    .map(l => (typeof l === 'string' ? l : `${l.language || ''} (${l.level || ''})`.replace(' ()', '')))
    .filter(Boolean)
    .join(', '));
}

function collectProfileFromForm() {
  const splitList = (id) => $(id).value.split(',').map(s => s.trim()).filter(Boolean);

  return {
    ...state.profile,
    identity: {
      ...state.profile?.identity,
      name: $('profName').value,
      title: $('profTitle').value,
      email: $('profEmail').value,
      phone: $('profPhone').value,
      location: $('profLocation').value,
      linkedin: $('profLinkedin').value,
      summary: $('profSummary').value
    },
    skills: {
      ...state.profile?.skills,
      primary: splitList('profPrimarySkills'),
      secondary: splitList('profSecondarySkills')
    },
    onboardingComplete: true
  };
}

function setupProfileTab() {
  const btnSave = $('btnSaveProfile');
  const btnParseCv = $('btnParseCv');
  const cvFileInput = $('cvFileInput');
  const cvDropzone = $('cvDropzone');

  $('btnExportData')?.addEventListener('click', async () => {
    try {
      await downloadFile('/api/profile/export', 'oppertunex-backup.json');
      showToast('Backup downloaded.', 'success');
    } catch (err) {
      if (err.status !== 401) showToast(err.message, 'error');
    }
  });

  btnSave.addEventListener('click', async () => {
    btnSave.disabled = true;
    try {
      const data = await api.post('/api/profile', collectProfileFromForm());
      if (data.success) {
        state.profile = data.profile;
        showToast('Profile saved.', 'success');
      }
    } catch (err) {
      if (err.status !== 401) showToast(err.message, 'error');
    } finally {
      btnSave.disabled = false;
    }
  });

  cvDropzone.addEventListener('click', () => cvFileInput.click());
  ['dragenter', 'dragover'].forEach(evt =>
    cvDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      cvDropzone.classList.add('dragover');
    }));
  ['dragleave', 'drop'].forEach(evt =>
    cvDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      cvDropzone.classList.remove('dragover');
    }));
  cvDropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadCvFile(file);
  });

  cvFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) uploadCvFile(file);
    cvFileInput.value = '';
  });

  btnParseCv.addEventListener('click', async () => {
    const rawText = $('cvRawTextarea').value;
    if (!rawText || rawText.trim().length < 40) {
      showToast('Paste your resume text first.', 'error');
      return;
    }

    btnParseCv.disabled = true;
    btnParseCv.innerHTML = '<span class="spinner"></span> Parsing...';
    try {
      const data = await api.post('/api/profile/upload-cv', { rawText });
      if (data.success) {
        state.profile = data.profile;
        populateProfileForm(data.profile);
        showToast(data.message, data.source === 'local-parser' ? 'warning' : 'success');
      }
    } catch (err) {
      if (err.status !== 401) showToast(err.message, 'error');
    } finally {
      btnParseCv.disabled = false;
      btnParseCv.innerHTML = '<span>Extract Profile with AI</span>';
    }
  });
}

async function uploadCvFile(file) {
  const formData = new FormData();
  formData.append('cvFile', file);
  showToast(`Reading ${file.name}...`);

  try {
    const data = await api.form('/api/profile/upload-cv', formData);
    if (data.success) {
      state.profile = data.profile;
      populateProfileForm(data.profile);
      showToast(data.message, data.source === 'local-parser' ? 'warning' : 'success');
    }
  } catch (err) {
    if (err.status !== 401) showToast(err.message, 'error');
  }
}

// ==========================================================================
// Job board
// ==========================================================================

function setupSearchTab() {
  $('btnExecuteSearch').addEventListener('click', () => executeSearch());

  ['searchQuery', 'searchLocation'].forEach(id => {
    $(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('btnExecuteSearch').click();
    });
  });

  $('hideSeenToggle')?.addEventListener('change', () => executeSearch());

  $('pageSizeSelect')?.addEventListener('change', (e) => {
    state.pageSize = parseInt(e.target.value, 10) || 12;
    state.currentPage = 1;
    renderCurrentJobPage();
  });

  $('btnPrevPage')?.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderCurrentJobPage(true);
    }
  });

  $('btnNextPage')?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(state.allSearchResults.length / state.pageSize));
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderCurrentJobPage(true);
    }
  });
}

async function executeSearch() {
  const query = $('searchQuery').value;
  const location = $('searchLocation').value;
  const portal = $('searchPortal').value;
  const hideSeen = $('hideSeenToggle')?.checked ? 'true' : 'false';

  const btnSearch = $('btnExecuteSearch');
  const grid = $('jobResultsGrid');

  btnSearch.disabled = true;
  btnSearch.innerHTML = '<span class="spinner"></span> Searching...';
  grid.innerHTML = '<div class="empty-state"><span class="spinner"></span><p>Searching...</p></div>';
  $('paginationBar')?.classList.add('hidden');

  try {
    const params = new URLSearchParams({ query, location, portal, hideSeen });
    const data = await api.get(`/api/scrape/search?${params}`);

    if (data.success && data.jobs?.length) {
      state.allSearchResults = data.jobs;
      state.currentPage = 1;
      state.detailAvailable = data.detailAvailable;
      renderCurrentJobPage();
      if (data.warning) showToast(data.warning, 'warning');
    } else {
      state.allSearchResults = [];
      $('resultsCount').textContent = '0 jobs found';
      const hidden = (data.totalBeforeFilter || 0) - (data.count || 0);
      grid.innerHTML = `
        <div class="empty-state">
          <h3>No jobs found</h3>
          <p>${escapeHtml(data.warning ||
            (hidden > 0
              ? `${hidden} result(s) were hidden by the applied/dismissed filter.`
              : 'Try different keywords, another location, or a different portal.'))}</p>
        </div>`;
    }
  } catch (err) {
    if (err.status !== 401) {
      grid.innerHTML = `<div class="empty-state"><h3>Search failed</h3><p>${escapeHtml(err.message)}</p></div>`;
    }
  } finally {
    btnSearch.disabled = false;
    btnSearch.innerHTML = '<span>Search Jobs</span>';
  }
}

function renderCurrentJobPage(scrollToTop = false) {
  const jobs = state.allSearchResults;
  const total = jobs.length;
  const pageSize = state.pageSize || 12;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);

  const startIndex = (state.currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);

  $('resultsCount').textContent = total === 1 ? '1 job found' : `${total} jobs found`;
  const info = $('paginationInfo');
  if (info) {
    info.textContent = total > 0
      ? `Showing ${startIndex + 1}–${endIndex} of ${total} (page ${state.currentPage} of ${totalPages})`
      : '';
  }

  renderJobCards(jobs.slice(startIndex, endIndex));

  $('paginationBar')?.classList.toggle('hidden', totalPages <= 1);
  const btnPrev = $('btnPrevPage');
  const btnNext = $('btnNextPage');
  if (btnPrev) btnPrev.disabled = state.currentPage <= 1;
  if (btnNext) btnNext.disabled = state.currentPage >= totalPages;

  const numbers = $('pageNumbersContainer');
  if (numbers) {
    numbers.innerHTML = '';
    for (let p = 1; p <= totalPages; p++) {
      const nearCurrent = p >= state.currentPage - 1 && p <= state.currentPage + 1;
      if (totalPages <= 7 || p === 1 || p === totalPages || nearCurrent) {
        const btn = document.createElement('button');
        btn.className = `page-num-btn ${p === state.currentPage ? 'active' : ''}`;
        btn.textContent = String(p);
        btn.setAttribute('aria-label', `Page ${p}`);
        btn.addEventListener('click', () => {
          state.currentPage = p;
          renderCurrentJobPage(true);
        });
        numbers.appendChild(btn);
      } else if (
        (p === state.currentPage - 2 && state.currentPage > 3) ||
        (p === state.currentPage + 2 && state.currentPage < totalPages - 2)
      ) {
        const span = document.createElement('span');
        span.className = 'page-ellipsis';
        span.textContent = '...';
        numbers.appendChild(span);
      }
    }
  }

  if (scrollToTop) {
    document.querySelector('.search-results-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderJobCards(jobs) {
  const grid = $('jobResultsGrid');
  grid.innerHTML = '';

  jobs.forEach(job => {
    const card = document.createElement('div');
    card.className = 'job-card' + (job.seenState === 'applied' ? ' is-applied' : '');

    // Every field is escaped. The skills list previously interpolated raw
    // scraped strings, which was a stored-XSS path.
    const tags = [job.location, job.seniority]
      .filter(Boolean)
      .concat((job.skills || []).slice(0, 4))
      .map(t => `<span class="meta-tag">${escapeHtml(t)}</span>`)
      .join('');

    const badges = [];
    if (job.isNew) badges.push('<span class="job-badge is-new">New</span>');
    if (job.seenState === 'applied') badges.push('<span class="job-badge is-applied">Applied</span>');

    const description = job.description
      ? escapeHtml(job.description.slice(0, 320)) + (job.description.length > 320 ? '...' : '')
      : '<em>No description supplied by this portal.</em>';

    card.innerHTML = `
      <div class="job-card-top">
        <div class="job-card-badges">${badges.join('')}</div>
        <h4 class="job-card-title">${escapeHtml(job.title || 'Untitled role')}</h4>
        <span class="job-card-company">${escapeHtml(job.company || 'Unknown company')}</span>
        <div class="job-card-meta">${tags}</div>
      </div>
      <div class="job-card-desc">${description}</div>
      <div class="job-card-footer">
        <span class="job-salary">${escapeHtml(job.salary || '')}</span>
        <div class="job-card-actions">
          <button class="btn btn-sm btn-ghost btn-dismiss" title="Hide this job from future searches">Dismiss</button>
          ${job.url ? `<a class="btn btn-sm btn-ghost" href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">View</a>` : ''}
          <button class="btn btn-sm btn-primary btn-apply-job">Analyze &amp; Apply</button>
        </div>
      </div>`;

    card.querySelector('.btn-apply-job').addEventListener('click', () => loadJobIntoApplyTab(job));
    card.querySelector('.btn-dismiss').addEventListener('click', async () => {
      try {
        await api.patch(`/api/scrape/jobs/${encodeURIComponent(job.id)}/state`, { state: 'dismissed' });
        card.remove();
        showToast('Dismissed. It will be hidden from future searches.', 'success');
      } catch (err) {
        if (err.status !== 401) showToast(err.message, 'error');
      }
    });

    grid.appendChild(card);
  });
}

/**
 * Pull the full posting before evaluating.
 *
 * Several portals return only a stub from search (LinkedIn's guest listing
 * carries a title, company and location and nothing else), and evaluating
 * that produces a score with almost no information behind it.
 */
async function enrichJobDescription(job) {
  if (!job.url || !job.portal) return job;
  if ((job.description || '').trim().length >= 400) return job;
  if (!state.detailAvailable) return job;

  showToast('Fetching the full posting...');
  try {
    const params = new URLSearchParams({ portal: job.portal, url: job.url });
    if (job.id) params.set('id', job.id);
    const data = await api.get(`/api/scrape/detail?${params}`);

    if (data.success && data.detail?.description) {
      return { ...job, ...data.detail, description: data.detail.description };
    }
    if (data.error) showToast(data.error, 'warning');
  } catch (err) {
    if (err.status !== 401) showToast(err.message, 'warning');
  }
  return job;
}

async function loadJobIntoApplyTab(job) {
  switchTab('apply');
  const enriched = await enrichJobDescription(job);

  state.currentJob = enriched;
  state.currentFitEvaluation = null;

  $('targetCompany').value = enriched.company || '';
  $('targetRole').value = enriched.title || '';
  $('targetLocation').value = enriched.location || '';
  $('targetUrl').value = enriched.url || '';
  $('targetDescription').value = enriched.description || '';

  if (!enriched.description || enriched.description.trim().length < 60) {
    showToast('Paste the full job description before evaluating. This portal only supplied a summary.', 'warning');
    $('targetDescription').focus();
    return;
  }

  showToast(`Loaded ${enriched.title}`, 'success');
  evaluateCurrentJob();
}

// ==========================================================================
// Apply
// ==========================================================================

function setupApplyTab() {
  $('btnEvaluateFit').addEventListener('click', evaluateCurrentJob);
  $('btnGenerateAll').addEventListener('click', generateApplication);
  $('btnDocCv').addEventListener('click', () => switchDocumentView('cv'));
  $('btnDocCover').addEventListener('click', () => switchDocumentView('cover'));

  $('btnToggleLatex').addEventListener('click', () => {
    state.isLatexView = !state.isLatexView;
    updateDocumentPreview();
  });

  $('btnRecompile').addEventListener('click', recompileCurrentLatex);

  $('btnOpenApplyLink')?.addEventListener('click', () => {
    const url = $('targetUrl')?.value || state.currentApplication?.jobUrl || state.currentJob?.url;
    if (url && /^https?:\/\//i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      showToast('No verified application URL is available for this role.', 'warning');
    }
  });

  $('btnMarkApplied')?.addEventListener('click', async () => {
    if (!state.currentApplication?.id) {
      showToast('Generate an application first.', 'error');
      return;
    }
    if (state.generationSource === 'unavailable') {
      showToast('Finish the offline template before marking this application as applied.', 'warning');
      return;
    }
    await tracker.setStatus(state.currentApplication.id, 'Applied');
    state.currentApplication.status = 'Applied';
    updateDocumentPreview();
  });

  $('btnDownloadPdf').addEventListener('click', async () => {
    if (!state.currentApplication) {
      showToast('Generate an application first.', 'error');
      return;
    }
    if (state.generationSource === 'unavailable') {
      showToast('Finish and recompile the offline template before downloading it.', 'warning');
      return;
    }
    const kind = state.activeDocType === 'cv' ? 'cv-pdf' : 'cover-pdf';
    try {
      await downloadFile(`/api/apply/download/${state.currentApplication.id}/${kind}`, `${kind}.pdf`);
    } catch (err) {
      if (err.status !== 401) showToast(err.message, 'error');
    }
  });
}

function getJobFromForm() {
  return {
    company: $('targetCompany').value.trim(),
    title: $('targetRole').value.trim(),
    location: $('targetLocation').value.trim(),
    url: $('targetUrl')?.value.trim() || '',
    description: $('targetDescription').value,
    id: state.currentJob?.id,
    portal: state.currentJob?.portal
  };
}

function validateJobForm(job) {
  if (!job.title) {
    showToast('Enter the role title.', 'error');
    $('targetRole').focus();
    return false;
  }
  if (!job.description || job.description.trim().length < 30) {
    showToast('Paste the job description first.', 'error');
    $('targetDescription').focus();
    return false;
  }
  return true;
}

async function evaluateCurrentJob() {
  const job = getJobFromForm();
  if (!validateJobForm(job)) return;

  const btn = $('btnEvaluateFit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Evaluating...';

  try {
    const data = await api.post('/api/evaluate', { job });
    if (data.success && data.evaluation) {
      state.currentFitEvaluation = data.evaluation.unavailable ? null : data.evaluation;
      renderFitEvaluation(data.evaluation);
      if (data.evaluation.unavailable) showToast(data.evaluation.message, 'warning');
      else showToast(`${data.evaluation.verdict} (${data.evaluation.overallScore}%)`, 'success');
    }
  } catch (err) {
    if (err.status !== 401) showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Run Fit Evaluation</span>';
  }
}

function renderFitEvaluation(ev) {
  $('evaluationCard').classList.remove('hidden');

  const badge = $('overallScoreBadge');
  const hasScore = typeof ev.overallScore === 'number';

  // No invented fallback score: "not evaluated" reads as not evaluated.
  if (hasScore) {
    const s = ev.overallScore;
    badge.className = `score-badge ${s >= 80 ? 'score-high' : s >= 60 ? 'score-mid' : 'score-low'}`;
    badge.querySelector('.score-val').textContent = `${s}%`;
  } else {
    badge.className = 'score-badge score-unknown';
    badge.querySelector('.score-val').textContent = '--';
  }
  badge.querySelector('.score-lbl').textContent = ev.verdict || 'Not evaluated';

  const renderGate = (el, gate, label) => {
    const status = gate?.status || 'UNKNOWN';
    el.className = `gate-pill ${status.toLowerCase()}`;
    const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '!' : '?';
    el.innerHTML = `<span class="gate-icon">${icon}</span><span>${label}: ${escapeHtml(status)}</span>`;
    el.title = gate?.note || '';
  };
  renderGate($('eligibilityGateBadge'), ev.eligibilityGate, 'Eligibility');
  renderGate($('languageGateBadge'), ev.languageGate, 'Language');

  const dimContainer = $('dimensionBars');
  dimContainer.innerHTML = '';

  const dimLabels = {
    technicalMatch: 'Technical skills',
    experienceMatch: 'Experience and function',
    seniorityMatch: 'Seniority and scope',
    growthMatch: 'Growth trajectory',
    domainMatch: 'Domain and culture'
  };
  const dims = ev.dimensions || {};

  if (!Object.keys(dims).length) {
    dimContainer.innerHTML = `<p class="muted">${escapeHtml(ev.message || 'No dimension scores available.')}</p>`;
  } else {
    Object.entries(dimLabels).forEach(([key, label]) => {
      const d = dims[key];
      const score = typeof d?.score === 'number' ? d.score : null;
      const item = document.createElement('div');
      item.className = 'dim-item';
      item.innerHTML = `
        <div class="dim-label-row">
          <span class="dim-name">${escapeHtml(label)}</span>
          <span class="dim-score">${score === null ? '--' : score + '%'}</span>
        </div>
        <div class="dim-bar-track">
          <div class="dim-bar-fill" style="width: ${score === null ? 0 : Math.max(0, Math.min(100, score))}%"></div>
        </div>
        ${d?.analysis ? `<p class="dim-analysis">${escapeHtml(d.analysis)}</p>` : ''}`;
      dimContainer.appendChild(item);
    });
  }

  const fill = (el, items, emptyText) => {
    el.innerHTML = items?.length
      ? items.map(s => `<li>${escapeHtml(s)}</li>`).join('')
      : `<li class="muted">${escapeHtml(emptyText)}</li>`;
  };
  fill($('evalStrengthsList'), ev.strengths, 'None identified.');
  fill($('evalGapsList'), ev.gaps, 'None identified.');
}

async function generateApplication() {
  const job = getJobFromForm();
  if (!validateJobForm(job)) return;

  const btnGenerate = $('btnGenerateAll');
  btnGenerate.disabled = true;
  btnGenerate.innerHTML = '<span class="spinner"></span> Generating...';
  $('pipelineStatusCard').classList.remove('hidden');
  resetPipelineSteps();

  const applyResult = (data) => {
    state.currentApplication = data.application;
    state.cvPdfBase64 = data.cvPdfBase64;
    state.coverPdfBase64 = data.coverPdfBase64;
    state.cvLatex = data.application.cvLatex;
    state.coverLatex = data.application.coverLetterLatex;
    state.generationSource = data.source || '';
    renderAuditBadges(data);
    updateDocumentPreview();
  };

  try {
    // Streamed, so each stage lands as the server finishes it rather than
    // everything arriving at the end.
    await postEventStream('/api/apply/generate/stream', {
      job,
      fitEvaluation: state.currentFitEvaluation
    }, {
      stage: ({ stage, status }) => setPipelineStep(`step-${stage}`, status),
      complete: async (data) => {
        applyResult(data);
        await tracker.load();
        if (data.warning) showToast(data.warning, 'warning');
        else showToast('Documents generated.', 'success');
      },
      error: (data) => {
        markPipelineFailed();
        showToast(data.error || 'Generation failed.', 'error');
      }
    });
  } catch (err) {
    markPipelineFailed();
    if (err.status !== 401) showToast(err.message, 'error');
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.innerHTML = '<span>Generate Tailored Application</span>';
  }
}

function resetPipelineSteps() {
  document.querySelectorAll('.pipeline-step').forEach(el => {
    el.classList.remove('active', 'done', 'skipped', 'failed');
  });
}

function setPipelineStep(stepId, status) {
  const el = $(stepId);
  if (!el) return;
  el.classList.remove('active', 'done', 'skipped', 'failed');
  el.classList.add(status);
  el.title = {
    active: 'In progress',
    done: 'Completed',
    skipped: 'Skipped (not available)',
    failed: 'Failed'
  }[status] || '';
}

function markPipelineFailed() {
  document.querySelectorAll('.pipeline-step.active').forEach(el => {
    el.classList.remove('active');
    el.classList.add('failed');
  });
}

/** Show what was actually verified, including when nothing was. */
function renderAuditBadges(data) {
  const container = $('auditBadges');
  if (!container) return;
  container.innerHTML = '';

  const badges = [];
  if (data.source === 'unavailable') badges.push({ text: 'Offline template, not tailored', kind: 'warn' });
  else if (data.source === 'ai-draft-only') badges.push({ text: 'Drafted, not reviewed', kind: 'warn' });
  else if (data.source === 'ai') badges.push({ text: 'Drafted and reviewed', kind: 'ok' });

  badges.push(data.cvRenderer === 'latex'
    ? { text: 'Compiled with LaTeX', kind: 'ok' }
    : { text: 'Preview render (no TeX engine)', kind: 'warn' });

  const ats = data.cvAtsVerification;
  if (ats?.verified) {
    badges.push({ text: ats.pass ? 'ATS text layer verified' : 'ATS check failed', kind: ats.pass ? 'ok' : 'warn' });
  } else {
    badges.push({ text: 'ATS not verified', kind: 'warn' });
  }

  (data.auditsPassed || []).forEach(a => badges.push({ text: a, kind: 'ok' }));

  badges.forEach(b => {
    const span = document.createElement('span');
    span.className = `audit-badge audit-${b.kind}`;
    span.textContent = b.text;
    container.appendChild(span);
  });
}

function switchDocumentView(docType) {
  state.activeDocType = docType;
  $('btnDocCv').classList.toggle('active', docType === 'cv');
  $('btnDocCover').classList.toggle('active', docType === 'cover');
  $('texFileName').textContent = docType === 'cv' ? 'main.tex' : 'cover.tex';
  updateDocumentPreview();
}

function base64ToBlob(base64Data, contentType = 'application/pdf') {
  const byteCharacters = atob((base64Data || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) bytes[i] = byteCharacters.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

function updateDocumentPreview() {
  const emptyState = $('docEmptyState');
  const pdfContainer = $('pdfContainer');
  const latexContainer = $('latexEditorContainer');
  const btnToggleLatex = $('btnToggleLatex');
  const btnRecompile = $('btnRecompile');
  const btnOpenApply = $('btnOpenApplyLink');
  const btnMarkApplied = $('btnMarkApplied');
  const reviewerFooter = $('reviewerFooter');
  const pdfFrame = $('pdfViewerFrame');

  if (!state.currentApplication) {
    emptyState.classList.remove('hidden');
    pdfContainer.classList.add('hidden');
    latexContainer.classList.add('hidden');
    reviewerFooter.classList.add('hidden');
    btnOpenApply?.classList.add('hidden');
    btnMarkApplied?.classList.add('hidden');
    state.generationSource = '';
    return;
  }

  emptyState.classList.add('hidden');
  reviewerFooter.classList.remove('hidden');
  btnOpenApply?.classList.remove('hidden');
  if (btnOpenApply) {
    const hasVerifiedUrl = /^https?:\/\//i.test(state.currentApplication.jobUrl || $('targetUrl')?.value || '');
    btnOpenApply.disabled = !hasVerifiedUrl;
    btnOpenApply.title = hasVerifiedUrl ? 'Open the verified job application link in a new tab' : 'No verified application URL is available';
  }

  if (btnMarkApplied) {
    btnMarkApplied.classList.remove('hidden');
    const applied = state.currentApplication.status === 'Applied';
    btnMarkApplied.disabled = applied || state.generationSource === 'unavailable';
    btnMarkApplied.textContent = applied ? 'Applied' : 'Mark Applied';
  }

  const currentPdf = state.activeDocType === 'cv' ? state.cvPdfBase64 : state.coverPdfBase64;
  editor.value = (state.activeDocType === 'cv' ? state.cvLatex : state.coverLatex) || '';

  if (state.isLatexView) {
    pdfContainer.classList.add('hidden');
    latexContainer.classList.remove('hidden');
    btnRecompile.classList.remove('hidden');
    btnToggleLatex.innerHTML = '<span>View PDF</span>';
    return;
  }

  latexContainer.classList.add('hidden');
  pdfContainer.classList.remove('hidden');
  btnRecompile.classList.add('hidden');
  btnToggleLatex.innerHTML = '<span>View LaTeX</span>';

  // Release the previous object URL. Without this every document switch
  // leaked a blob for the lifetime of the page.
  if (state.activePdfObjectUrl) {
    URL.revokeObjectURL(state.activePdfObjectUrl);
    state.activePdfObjectUrl = null;
  }

  if (currentPdf) {
    try {
      const blobUrl = URL.createObjectURL(base64ToBlob(currentPdf));
      state.activePdfObjectUrl = blobUrl;
      pdfFrame.src = blobUrl;
    } catch {
      pdfFrame.removeAttribute('src');
      showToast('Could not render the PDF preview. Use Download instead.', 'warning');
    }
  }
}

async function recompileCurrentLatex() {
  const latexContent = editor.value;
  const type = state.activeDocType;
  const btn = $('btnRecompile');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Compiling...';

  try {
    const data = await api.post('/api/apply/compile', {
      type,
      latexContent,
      appId: state.currentApplication?.id
    });

    if (data.success && data.pdfBase64) {
      if (type === 'cv') {
        state.cvPdfBase64 = data.pdfBase64;
        state.cvLatex = latexContent;
      } else {
        state.coverPdfBase64 = data.pdfBase64;
        state.coverLatex = latexContent;
      }

      // Surface compile errors against the lines they came from.
      const errors = editor.markErrorsFromLog(data.logs);
      if (errors.length) {
        const first = errors.find(e => e.line);
        showToast(`LaTeX reported ${errors.length} problem(s). ${first ? `Line ${first.line}: ` : ''}${errors[0].message}`, 'warning');
        if (first) editor.goToLine(first.line);
        return;
      }

      state.isLatexView = false;
      // A successful user-initiated compile is the explicit acknowledgement
      // required before an offline template can be downloaded or applied.
      if (state.generationSource === 'unavailable') state.generationSource = 'user-reviewed';
      updateDocumentPreview();
      showToast(
        data.renderer === 'latex' ? 'Compiled.' : (data.note || 'Preview rendered.'),
        data.renderer === 'latex' ? 'success' : 'warning'
      );
    }
  } catch (err) {
    if (err.status !== 401) showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Recompile</span>';
  }
}

// ==========================================================================
// Interview prep
// ==========================================================================

function setupInterviewTab() {
  $('btnGenerateInterview').addEventListener('click', generateInterviewQuestions);
}

async function generateInterviewQuestions() {
  const job = getJobFromForm();
  if (!job.title) {
    showToast('Load a job on the Apply tab first.', 'error');
    switchTab('apply');
    return;
  }

  const btn = $('btnGenerateInterview');
  const content = $('interviewContent');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Preparing...';
  content.innerHTML = '<div class="empty-state"><span class="spinner"></span><p>Building your preparation...</p></div>';

  try {
    const data = await api.post('/api/interview/generate', { job });
    if (data.success && data.prep) {
      renderInterviewCards(data.prep);
      if (data.prep.unavailable) showToast(data.prep.message, 'warning');
      else showToast('Interview preparation ready.', 'success');
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Could not generate preparation</h3><p>${escapeHtml(err.message)}</p></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Generate Questions for Current Job</span>';
  }
}

function renderInterviewCards(prep) {
  const container = $('interviewContent');
  container.innerHTML = '';

  if (prep.unavailable) {
    container.innerHTML = `<div class="empty-state"><h3>Not available</h3><p>${escapeHtml(prep.message)}</p></div>`;
    return;
  }

  const section = (title) => {
    const el = document.createElement('div');
    el.className = 'interview-section';
    el.innerHTML = `<h4 class="section-heading">${escapeHtml(title)}</h4>`;
    return el;
  };

  // companyContext and strategicTalkingPoints were generated by the API and
  // then discarded by the client.
  if (prep.companyContext) {
    const ctx = section('Company context');
    const p = document.createElement('p');
    p.className = 'company-context';
    p.textContent = prep.companyContext;
    ctx.appendChild(p);
    container.appendChild(ctx);
  }

  if (prep.starQuestions?.length) {
    const star = section('Behavioural and technical STAR answers');
    prep.starQuestions.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'star-card';
      card.innerHTML = `
        <div class="star-question">Q${idx + 1}: ${escapeHtml(q.question)}</div>
        ${q.competency ? `<div class="star-competency">${escapeHtml(q.competency)}</div>` : ''}
        <div class="star-grid">
          ${['situation', 'task', 'action', 'result'].map(part => `
            <div class="star-part">
              <h5>${part[0].toUpperCase() + part.slice(1)}</h5>
              <p>${escapeHtml(q[part] || '')}</p>
            </div>`).join('')}
        </div>`;
      star.appendChild(card);
    });
    container.appendChild(star);
  }

  if (prep.questionsToAsk?.length) {
    const ask = section('Questions to ask the interviewer');
    prep.questionsToAsk.forEach(item => {
      const box = document.createElement('div');
      box.className = 'eval-box';
      box.innerHTML = `
        <h4>"${escapeHtml(item.question)}"</h4>
        <p><strong>Why:</strong> ${escapeHtml(item.rationale || '')}</p>`;
      ask.appendChild(box);
    });
    container.appendChild(ask);
  }

  if (prep.strategicTalkingPoints?.length) {
    const points = section('Talking points to emphasise');
    const ul = document.createElement('ul');
    ul.className = 'talking-points';
    prep.strategicTalkingPoints.forEach(p => {
      const li = document.createElement('li');
      li.textContent = p;
      ul.appendChild(li);
    });
    points.appendChild(ul);
    container.appendChild(points);
  }
}

document.addEventListener('DOMContentLoaded', init);
