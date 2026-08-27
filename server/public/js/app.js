/**
 * AI Job Search - frontend client.
 */

document.addEventListener('DOMContentLoaded', () => {
  const SESSION_KEY = 'jobsearch_auth_session';
  const LEGACY_KEY = 'jobsearch_auth_token';

  // ==========================================
  // State
  // ==========================================
  const state = {
    authToken: '',
    sessionExpiresAt: 0,
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
    // These three were previously left undefined, so the pagination handlers
    // computed Math.ceil(total / undefined) === NaN and silently did nothing.
    allSearchResults: [],
    currentPage: 1,
    pageSize: 12,
    lastSearchMeta: null,
    trackerApps: [],
    statuses: ['Drafted', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn'],
    activePdfObjectUrl: null
  };

  // ==========================================
  // Token storage
  // ==========================================
  function getCachedToken() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.expiresAt && parsed.expiresAt > Date.now()) {
          state.sessionExpiresAt = parsed.expiresAt;
          return parsed.token;
        }
      }
    } catch (e) { /* fall through to clear */ }
    clearCachedToken();
    return '';
  }

  function setCachedToken(token, expiresAt) {
    state.authToken = token;
    state.sessionExpiresAt = expiresAt;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
  }

  // Clears both keys. Clearing only one left a stale token that was restored
  // from the other on the next page load.
  function clearCachedToken() {
    state.authToken = '';
    state.sessionExpiresAt = 0;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_KEY);
  }

  // ==========================================
  // DOM
  // ==========================================
  const $ = (id) => document.getElementById(id);
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const toastContainer = $('toastContainer');
  const aiStatusBadge = $('aiStatusBadge');
  const aiStatusText = $('aiStatusText');
  const btnLogout = $('btnLogout');
  const loginOverlay = $('loginOverlay');
  const loginForm = $('loginForm');
  const loginPasswordInput = $('loginPasswordInput');
  const loginError = $('loginError');

  // ==========================================
  // Networking
  // ==========================================
  async function authFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.authToken) headers.set('Authorization', `Bearer ${state.authToken}`);

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      clearCachedToken();
      showLoginModal('Session expired. Please unlock again.');
      throw new Error('Unauthorized');
    }
    return res;
  }

  /** Parse a response as JSON, turning a non-JSON body into a useful message. */
  async function readJson(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        res.ok
          ? 'The server returned an unexpected response.'
          : `Server error ${res.status}. ${text.slice(0, 140)}`
      );
    }
  }

  async function apiGet(url) {
    return readJson(await authFetch(url));
  }

  async function apiPost(url, body) {
    return readJson(await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }));
  }

  // ==========================================
  // Auth
  // ==========================================
  function setupAuth() {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = loginPasswordInput.value;
      if (!password) return;

      const submitBtn = $('btnLoginSubmit');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span> Verifying...';
      loginError.classList.add('hidden');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await readJson(res);

        if (data.success && data.token) {
          setCachedToken(data.token, data.expiresAt);
          loginOverlay.classList.add('hidden');
          loginPasswordInput.value = '';
          showToast('Workspace unlocked.', 'success');
          await postLoginInit();
        } else {
          loginError.textContent = data.error || 'Incorrect password.';
          loginError.classList.remove('hidden');
        }
      } catch (err) {
        loginError.textContent = err.message || 'Connection error. Please try again.';
        loginError.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Unlock Workspace</span>';
      }
    });

    btnLogout.addEventListener('click', () => {
      clearCachedToken();
      showLoginModal('Workspace locked.');
    });
  }

  function showLoginModal(msg = '') {
    if (msg) {
      loginError.textContent = msg;
      loginError.classList.remove('hidden');
    }
    loginOverlay.classList.remove('hidden');
    loginPasswordInput.focus();
  }

  // ==========================================
  // Init
  // ==========================================
  async function init() {
    state.authToken = getCachedToken();

    setupAuth();
    setupNavigation();
    setupProfileTab();
    setupSearchTab();
    setupApplyTab();
    setupInterviewTab();
    setupTrackerTab();

    await checkHealth();
    await loadPortals();

    if (!state.authToken) {
      showLoginModal();
      return;
    }

    // Verify before rendering anything, so an invalid token shows the lock
    // screen rather than a burst of failing requests behind it.
    try {
      const res = await fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${state.authToken}` }
      });
      if (!res.ok) {
        clearCachedToken();
        showLoginModal('Session expired. Please unlock again.');
        return;
      }
    } catch {
      showToast('Could not reach the server. Working from cache.', 'error');
    }

    loginOverlay.classList.add('hidden');
    await postLoginInit();
  }

  async function postLoginInit() {
    await loadProfile();
    await loadTrackerApplications();
  }

  async function checkHealth() {
    try {
      const data = await readJson(await fetch('/api/health'));
      if (data.aiConfigured) {
        aiStatusBadge.className = 'status-pill connected';
        aiStatusText.textContent = data.provider || 'AI engine ready';
      } else {
        aiStatusBadge.className = 'status-pill warning';
        aiStatusText.textContent = 'No AI provider configured';
      }
      aiStatusBadge.title = data.aiConfigured
        ? `Provider: ${data.provider}`
        : 'Set an API key in server/.env. Evaluation and drafting will report themselves unavailable until then.';
    } catch (err) {
      aiStatusBadge.className = 'status-pill warning';
      aiStatusText.textContent = 'Server unreachable';
    }
  }

  /** Build the portal dropdown from what the server can actually run. */
  async function loadPortals() {
    const select = $('searchPortal');
    if (!select) return;
    try {
      const data = await readJson(await fetch('/api/scrape/portals'));
      if (!data.success || !data.portals?.length) return;

      select.innerHTML = '';
      data.portals.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        opt.dataset.defaultLocation = p.defaultLocation || '';
        select.appendChild(opt);
      });
    } catch {
      // Leave the markup's own options in place if the call fails.
    }
  }

  // ==========================================
  // Navigation
  // ==========================================
  function setupNavigation() {
    navTabs.forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  }

  function switchTab(tabId) {
    navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    tabPanes.forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
  }

  // ==========================================
  // Profile
  // ==========================================
  async function loadProfile() {
    try {
      const data = await apiGet('/api/profile');
      if (data.success && data.profile) {
        state.profile = data.profile;
        populateProfileForm(data.profile);
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast('Could not load your profile.', 'error');
    }
  }

  function populateProfileForm(p) {
    if (!p) return;
    const ident = p.identity || {};
    const setVal = (id, val) => { const el = $(id); if (el) el.value = val || ''; };

    setVal('profName', ident.name);
    setVal('profTitle', ident.title);
    setVal('profEmail', ident.email);
    setVal('profPhone', ident.phone);
    setVal('profLocation', ident.location);
    setVal('profLinkedin', ident.linkedin);
    setVal('profSummary', ident.summary);

    const skills = p.skills || {};
    const join = (v) => (Array.isArray(v) ? v.join(', ') : (v || ''));
    setVal('profPrimarySkills', join(skills.primary));
    setVal('profSecondarySkills', join(skills.secondary));

    setVal('profLanguages', (ident.languages || [])
      .map(l => (typeof l === 'string' ? l : `${l.language || l.name || ''} (${l.level || ''})`.replace(' ()', '')))
      .filter(Boolean)
      .join(', '));
  }

  function setupProfileTab() {
    const btnSave = $('btnSaveProfile');
    const btnParseCv = $('btnParseCv');
    const cvFileInput = $('cvFileInput');
    const cvDropzone = $('cvDropzone');

    btnSave.addEventListener('click', async () => {
      const splitList = (id) => $(id).value.split(',').map(s => s.trim()).filter(Boolean);

      const updated = {
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
        }
      };

      btnSave.disabled = true;
      try {
        const data = await apiPost('/api/profile', updated);
        if (data.success) {
          state.profile = data.profile;
          showToast('Profile saved.', 'success');
        } else {
          showToast(data.error || 'Could not save your profile.', 'error');
        }
      } catch (err) {
        if (err.message !== 'Unauthorized') showToast(err.message, 'error');
      } finally {
        btnSave.disabled = false;
      }
    });

    cvDropzone.addEventListener('click', () => cvFileInput.click());

    // Drag and drop, which the dropzone visually invited but never supported.
    ['dragenter', 'dragover'].forEach(evt => {
      cvDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        cvDropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      cvDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        cvDropzone.classList.remove('dragover');
      });
    });
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
        const data = await apiPost('/api/profile/upload-cv', { rawText });
        if (data.success) {
          state.profile = data.profile;
          populateProfileForm(data.profile);
          showToast(data.message || 'Profile updated.', data.source === 'local-parser' ? 'warning' : 'success');
        } else {
          showToast(data.error || 'Could not parse that resume.', 'error');
        }
      } catch (err) {
        if (err.message !== 'Unauthorized') showToast(err.message, 'error');
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
      const data = await readJson(await authFetch('/api/profile/upload-cv', {
        method: 'POST',
        body: formData
      }));
      if (data.success) {
        state.profile = data.profile;
        populateProfileForm(data.profile);
        showToast(data.message || 'Profile updated.', data.source === 'local-parser' ? 'warning' : 'success');
      } else {
        showToast(data.error || 'Could not read that file.', 'error');
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message, 'error');
    }
  }

  // ==========================================
  // Search
  // ==========================================
  function setupSearchTab() {
    $('btnExecuteSearch').addEventListener('click', () => {
      executeSearch($('searchQuery').value, $('searchLocation').value, $('searchPortal').value);
    });

    // Enter submits from either text field.
    ['searchQuery', 'searchLocation'].forEach(id => {
      $(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('btnExecuteSearch').click();
      });
    });

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

  async function executeSearch(query, location, portal) {
    const btnSearch = $('btnExecuteSearch');
    const resultsGrid = $('jobResultsGrid');
    const paginationBar = $('paginationBar');

    btnSearch.disabled = true;
    btnSearch.innerHTML = '<span class="spinner"></span> Searching...';
    resultsGrid.innerHTML = '<div class="empty-state"><span class="spinner"></span><p>Searching...</p></div>';
    paginationBar?.classList.add('hidden');

    try {
      const url = `/api/scrape/search?query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&portal=${encodeURIComponent(portal)}`;
      const data = await apiGet(url);

      state.lastSearchMeta = { source: data.source, isSample: data.isSample, warning: data.warning };

      if (data.success && data.jobs?.length) {
        state.allSearchResults = data.jobs;
        state.currentPage = 1;
        renderCurrentJobPage();
        if (data.warning) showToast(data.warning, 'warning');
      } else {
        state.allSearchResults = [];
        $('resultsCount').textContent = '0 jobs found';
        $('paginationInfo') && ($('paginationInfo').textContent = '');
        resultsGrid.innerHTML = `
          <div class="empty-state">
            <h3>No jobs found</h3>
            <p>${escapeHtml(data.warning || 'Try different keywords, another location, or a different portal.')}</p>
          </div>`;
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        resultsGrid.innerHTML = `<div class="empty-state"><h3>Search failed</h3><p>${escapeHtml(err.message)}</p></div>`;
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
    const paginationInfo = $('paginationInfo');
    if (paginationInfo) {
      paginationInfo.textContent = total > 0
        ? `Showing ${startIndex + 1}–${endIndex} of ${total} (page ${state.currentPage} of ${totalPages})`
        : '';
    }

    renderJobCards(jobs.slice(startIndex, endIndex));

    const paginationBar = $('paginationBar');
    paginationBar?.classList.toggle('hidden', totalPages <= 1);

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
          btn.textContent = p;
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
      card.className = 'job-card';

      // Every field is escaped. The skills list previously interpolated raw
      // scraped strings, which was a stored-XSS path.
      const tags = [job.location, job.seniority]
        .filter(Boolean)
        .concat((job.skills || []).slice(0, 4))
        .map(t => `<span class="meta-tag">${escapeHtml(t)}</span>`)
        .join('');

      const description = job.description
        ? escapeHtml(job.description.slice(0, 320)) + (job.description.length > 320 ? '...' : '')
        : '<em>No description supplied by this portal.</em>';

      card.innerHTML = `
        <div class="job-card-top">
          <h4 class="job-card-title">${escapeHtml(job.title || 'Untitled role')}</h4>
          <span class="job-card-company">${escapeHtml(job.company || 'Unknown company')}</span>
          <div class="job-card-meta">${tags}</div>
        </div>
        <div class="job-card-desc">${description}</div>
        <div class="job-card-footer">
          <span class="job-salary">${escapeHtml(job.salary || '')}</span>
          <div class="job-card-actions">
            ${job.url ? `<a class="btn btn-sm btn-ghost" href="${escapeAttr(job.url)}" target="_blank" rel="noopener noreferrer">View posting</a>` : ''}
            <button class="btn btn-sm btn-primary btn-apply-job">Analyze &amp; Apply</button>
          </div>
        </div>`;

      card.querySelector('.btn-apply-job').addEventListener('click', () => loadJobIntoApplyTab(job));
      grid.appendChild(card);
    });
  }

  function loadJobIntoApplyTab(job) {
    state.currentJob = job;
    state.currentFitEvaluation = null;

    $('targetCompany').value = job.company || '';
    $('targetRole').value = job.title || '';
    $('targetLocation').value = job.location || '';
    $('targetUrl').value = job.url || '';
    $('targetDescription').value = job.description || '';

    switchTab('apply');

    if (!job.description || job.description.trim().length < 60) {
      // LinkedIn's guest listing only carries a stub. Evaluating that produces
      // a meaningless score, so ask for the real text instead of guessing.
      showToast('Paste the full job description before evaluating. This portal only supplies a summary.', 'warning');
      $('targetDescription').focus();
      return;
    }

    showToast(`Loaded ${job.title}`, 'success');
    evaluateCurrentJob();
  }

  // ==========================================
  // Apply
  // ==========================================
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
        const comp = encodeURIComponent($('targetCompany').value || '');
        const role = encodeURIComponent($('targetRole').value || '');
        window.open(`https://www.google.com/search?q=${comp}+${role}+careers`, '_blank', 'noopener,noreferrer');
      }
    });

    $('btnMarkApplied')?.addEventListener('click', async () => {
      if (!state.currentApplication?.id) {
        showToast('Generate an application first.', 'error');
        return;
      }
      await updateApplicationStatus(state.currentApplication.id, 'Applied');
      state.currentApplication.status = 'Applied';
      updateDocumentPreview();
    });

    $('btnDownloadPdf').addEventListener('click', () => {
      if (!state.currentApplication) {
        showToast('Generate an application first.', 'error');
        return;
      }
      downloadDocument(state.currentApplication.id, state.activeDocType === 'cv' ? 'cv-pdf' : 'cover-pdf');
    });
  }

  /**
   * Download through fetch so the token travels in a header.
   * A plain link needed ?token=... in the URL, which put the credential into
   * browser history, server logs and Referer headers.
   */
  async function downloadDocument(appId, kind) {
    try {
      const res = await authFetch(`/api/apply/download/${appId}/${kind}`);
      if (!res.ok) {
        const data = await readJson(res).catch(() => ({}));
        showToast(data.error || 'Download failed.', 'error');
        return;
      }

      const disposition = res.headers.get('Content-Disposition') || '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `${kind}.pdf`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message, 'error');
    }
  }

  function getJobFromForm() {
    return {
      company: $('targetCompany').value.trim(),
      title: $('targetRole').value.trim(),
      location: $('targetLocation').value.trim(),
      url: $('targetUrl')?.value.trim() || '',
      description: $('targetDescription').value
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
      const data = await apiPost('/api/evaluate', { job });
      if (data.success && data.evaluation) {
        state.currentFitEvaluation = data.evaluation.unavailable ? null : data.evaluation;
        renderFitEvaluation(data.evaluation);

        if (data.evaluation.unavailable) {
          showToast(data.evaluation.message, 'warning');
        } else {
          showToast(`${data.evaluation.verdict} (${data.evaluation.overallScore}%)`, 'success');
        }
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>Run Fit Evaluation</span>';
    }
  }

  function renderFitEvaluation(ev) {
    const evalCard = $('evaluationCard');
    evalCard.classList.remove('hidden');

    const badge = $('overallScoreBadge');
    const hasScore = typeof ev.overallScore === 'number';

    // No invented fallback score. "Not evaluated" reads as not evaluated.
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
    const pipelineCard = $('pipelineStatusCard');

    btnGenerate.disabled = true;
    btnGenerate.innerHTML = '<span class="spinner"></span> Generating...';
    pipelineCard.classList.remove('hidden');

    // Real stage tracking. The old version fired timers at fixed delays, so
    // steps reported themselves complete regardless of what the server did.
    resetPipelineSteps();
    setPipelineStep('step-drafter', 'active');

    try {
      const data = await apiPost('/api/apply/generate', {
        job,
        fitEvaluation: state.currentFitEvaluation
      });

      if (data.success) {
        setPipelineStep('step-drafter', 'done');
        setPipelineStep('step-reviewer', data.source === 'ai' ? 'done' : 'skipped');
        setPipelineStep('step-latex', data.cvRenderer === 'latex' ? 'done' : 'skipped');
        setPipelineStep('step-ats', data.cvAtsVerification?.verified ? 'done' : 'skipped');

        state.currentApplication = data.application;
        state.cvPdfBase64 = data.cvPdfBase64;
        state.coverPdfBase64 = data.coverPdfBase64;
        state.cvLatex = data.application.cvLatex;
        state.coverLatex = data.application.coverLetterLatex;

        renderAuditBadges(data);
        updateDocumentPreview();
        await loadTrackerApplications();

        if (data.warning) showToast(data.warning, 'warning');
        else showToast('Documents generated.', 'success');
      } else {
        markPipelineFailed();
        showToast(data.error || 'Generation failed.', 'error');
      }
    } catch (err) {
      markPipelineFailed();
      if (err.message !== 'Unauthorized') showToast(err.message, 'error');
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

    if (data.source === 'unavailable') {
      badges.push({ text: 'Offline template, not tailored', kind: 'warn' });
    } else if (data.source === 'ai-draft-only') {
      badges.push({ text: 'Drafted, not reviewed', kind: 'warn' });
    } else if (data.source === 'ai') {
      badges.push({ text: 'Drafted and reviewed', kind: 'ok' });
    }

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
    const latexTextarea = $('latexSourceTextarea');

    if (!state.currentApplication) {
      emptyState.classList.remove('hidden');
      pdfContainer.classList.add('hidden');
      latexContainer.classList.add('hidden');
      reviewerFooter.classList.add('hidden');
      btnOpenApply?.classList.add('hidden');
      btnMarkApplied?.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    reviewerFooter.classList.remove('hidden');
    btnOpenApply?.classList.remove('hidden');

    if (btnMarkApplied) {
      btnMarkApplied.classList.remove('hidden');
      const applied = state.currentApplication.status === 'Applied';
      btnMarkApplied.disabled = applied;
      btnMarkApplied.textContent = applied ? 'Applied' : 'Mark Applied';
    }

    const currentPdf = state.activeDocType === 'cv' ? state.cvPdfBase64 : state.coverPdfBase64;
    latexTextarea.value = (state.activeDocType === 'cv' ? state.cvLatex : state.coverLatex) || '';

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
      } catch (err) {
        console.warn('Could not render the inline PDF:', err);
        pdfFrame.removeAttribute('src');
        showToast('Could not render the PDF preview. Use Download instead.', 'warning');
      }
    }
  }

  async function recompileCurrentLatex() {
    const latexContent = $('latexSourceTextarea').value;
    const type = state.activeDocType;
    const btn = $('btnRecompile');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Compiling...';

    try {
      const data = await apiPost('/api/apply/compile', {
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
        state.isLatexView = false;
        updateDocumentPreview();
        showToast(data.renderer === 'latex' ? 'Compiled.' : (data.note || 'Preview rendered.'),
          data.renderer === 'latex' ? 'success' : 'warning');
      } else {
        showToast(data.error || 'Compilation failed.', 'error');
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>Recompile</span>';
    }
  }

  // ==========================================
  // Interview prep
  // ==========================================
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
      const data = await apiPost('/api/interview/generate', { job });
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

    // These two were generated and returned by the API but never rendered.
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

  // ==========================================
  // Tracker
  // ==========================================
  function setupTrackerTab() {
    // The board used to be inert: setupTrackerTab was an empty function, so
    // Interviewing and Offer were unreachable and nothing could be deleted.
    Object.keys(columnIds()).forEach(status => {
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
        if (id) await updateApplicationStatus(id, status);
      });
    });
  }

  function columnIds() {
    return { Drafted: 1, Applied: 1, Interviewing: 1, Offer: 1 };
  }

  async function loadTrackerApplications() {
    try {
      const data = await apiGet('/api/tracker');
      if (data.success) {
        state.trackerApps = data.applications || [];
        if (data.statuses) state.statuses = data.statuses;
        renderKanban(state.trackerApps);
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') console.warn('Tracker load failed:', err.message);
    }
  }

  async function updateApplicationStatus(id, status) {
    try {
      const data = await readJson(await authFetch(`/api/tracker/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      }));
      if (data.success) {
        showToast(`Moved to ${status}.`, 'success');
        await loadTrackerApplications();
      } else {
        showToast(data.error || 'Could not update status.', 'error');
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message, 'error');
    }
  }

  async function deleteApplication(id, label) {
    if (!window.confirm(`Delete the application for ${label}? This cannot be undone.`)) return;
    try {
      const data = await readJson(await authFetch(`/api/tracker/${id}`, { method: 'DELETE' }));
      if (data.success) {
        showToast('Application deleted.', 'success');
        if (state.currentApplication?.id === id) state.currentApplication = null;
        await loadTrackerApplications();
      } else {
        showToast(data.error || 'Could not delete.', 'error');
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message, 'error');
    }
  }

  function renderKanban(apps) {
    const statuses = Object.keys(columnIds());
    const counts = Object.fromEntries(statuses.map(s => [s, 0]));

    statuses.forEach(s => {
      const col = $(`col-${s}`);
      if (col) col.innerHTML = '';
    });

    apps.forEach(app => {
      // Anything not shown as a column (Rejected, Withdrawn) still needs a
      // home, so it lands in Drafted rather than vanishing.
      const status = statuses.includes(app.status) ? app.status : 'Drafted';
      counts[status]++;

      const col = $(`col-${status}`);
      if (!col) return;

      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.draggable = true;
      card.dataset.appId = app.id;

      const fit = typeof app.fitScore === 'number' ? `${app.fitScore}%` : 'not scored';
      const created = app.createdAt ? new Date(app.createdAt).toLocaleDateString() : '';

      card.innerHTML = `
        <div class="kanban-card-head">
          <h4>${escapeHtml(app.jobTitle || 'Role')}</h4>
          <button class="kanban-delete" aria-label="Delete application" title="Delete">&times;</button>
        </div>
        <div class="company">${escapeHtml(app.company || 'Company')}</div>
        <div class="kanban-meta">
          <span>Fit: ${escapeHtml(fit)}</span>
          <span>${escapeHtml(created)}</span>
        </div>
        <select class="kanban-status" aria-label="Change status">
          ${state.statuses.map(s =>
            `<option value="${escapeAttr(s)}"${s === app.status ? ' selected' : ''}>${escapeHtml(s)}</option>`
          ).join('')}
        </select>`;

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', app.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));

      card.querySelector('.kanban-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteApplication(app.id, app.jobTitle || 'this role');
      });

      card.querySelector('.kanban-status').addEventListener('change', (e) => {
        updateApplicationStatus(app.id, e.target.value);
      });

      col.appendChild(card);
    });

    statuses.forEach(status => {
      const pill = $(`count-${status}`);
      if (pill) pill.textContent = counts[status];
    });
  }

  // ==========================================
  // Utilities
  // ==========================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    toastContainer.appendChild(toast);

    // Warnings and errors deserve longer than a success ping.
    const ttl = type === 'error' || type === 'warning' ? 7000 : 3500;
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, ttl);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const escapeAttr = escapeHtml;

  init();
});
