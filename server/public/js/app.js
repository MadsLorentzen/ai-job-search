/**
 * AI Job Search - Main Frontend Client Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  function getCachedToken() {
    try {
      const raw = localStorage.getItem('jobsearch_auth_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.expiresAt && parsed.expiresAt > Date.now()) {
          return parsed.token;
        } else {
          localStorage.removeItem('jobsearch_auth_session');
          localStorage.removeItem('jobsearch_auth_token');
          return '';
        }
      }
    } catch (e) {}
    return localStorage.getItem('jobsearch_auth_token') || '';
  }

  function setCachedToken(token) {
    const sessionData = {
      token,
      expiresAt: Date.now() + SESSION_DURATION_MS
    };
    localStorage.setItem('jobsearch_auth_session', JSON.stringify(sessionData));
    localStorage.setItem('jobsearch_auth_token', token);
  }

  function clearCachedToken() {
    localStorage.removeItem('jobsearch_auth_session');
    localStorage.removeItem('jobsearch_auth_token');
  }

  // Global State
  const state = {
    authToken: getCachedToken(),
    profile: null,
    currentJob: null,
    currentFitEvaluation: null,
    currentApplication: null,
    activeDocType: 'cv', // 'cv' or 'cover'
    isLatexView: false,
    cvPdfBase64: null,
    coverPdfBase64: null,
    cvLatex: '',
    coverLatex: ''
  };

  // DOM Elements
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const toastContainer = document.getElementById('toastContainer');
  const aiStatusBadge = document.getElementById('aiStatusBadge');
  const aiStatusText = document.getElementById('aiStatusText');
  const btnLogout = document.getElementById('btnLogout');
  const loginOverlay = document.getElementById('loginOverlay');
  const loginForm = document.getElementById('loginForm');
  const loginPasswordInput = document.getElementById('loginPasswordInput');
  const loginError = document.getElementById('loginError');

  // ==========================================
  // 1. Authentication & Network Wrapper
  // ==========================================
  async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (state.authToken) {
      if (options.headers instanceof Headers) {
        options.headers.set('Authorization', `Bearer ${state.authToken}`);
      } else {
        options.headers['Authorization'] = `Bearer ${state.authToken}`;
      }
    }

    const res = await fetch(url, options);
    if (res.status === 401) {
      clearCachedToken();
      state.authToken = '';
      showLoginModal('Session expired or password required.');
      throw new Error('Unauthorized');
    }
    return res;
  }

  function setupAuth() {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = loginPasswordInput.value;
      if (!password) return;

      const submitBtn = document.getElementById('btnLoginSubmit');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner"></span> Verifying...`;
      loginError.classList.add('hidden');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success && data.token) {
          state.authToken = data.token;
          setCachedToken(data.token);
          loginOverlay.classList.add('hidden');
          loginPasswordInput.value = '';
          showToast('Workspace unlocked! (7-day session active)', 'success');
          await postLoginInit();
        } else {
          loginError.textContent = data.error || 'Incorrect Password.';
          loginError.classList.remove('hidden');
        }
      } catch (err) {
        loginError.textContent = 'Connection error. Please try again.';
        loginError.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Unlock Workspace</span>`;
      }
    });

    btnLogout.addEventListener('click', () => {
      state.authToken = '';
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
  // 2. Initial Setup & Health Check
  // ==========================================
  async function init() {
    setupAuth();
    setupNavigation();
    setupProfileTab();
    setupSearchTab();
    setupApplyTab();
    setupInterviewTab();
    setupTrackerTab();

    await checkHealth();

    // Check cached session
    if (state.authToken) {
      // Keep modal hidden and initialize app immediately
      loginOverlay.classList.add('hidden');
      postLoginInit().catch(err => console.warn('Post login init:', err));

      // Silently verify in background
      try {
        const res = await fetch('/api/auth/verify', {
          headers: { 'Authorization': `Bearer ${state.authToken}` }
        });
        if (!res.ok) {
          state.authToken = '';
          localStorage.removeItem('jobsearch_auth_token');
          showLoginModal('Session expired. Please unlock again.');
        }
      } catch (err) {
        // Network warning - don't lock if offline/slow
      }
    } else {
      showLoginModal();
    }
  }

  async function postLoginInit() {
    await loadProfile();
    await loadTrackerApplications();
    await executeInitialSearch();
  }

  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (data.aiConfigured) {
        aiStatusBadge.className = 'status-pill connected';
        aiStatusText.textContent = 'Claude Engine Ready';
      } else {
        aiStatusBadge.className = 'status-pill';
        aiStatusText.textContent = 'Demo Mode (Mock Active)';
      }
    } catch (err) {
      console.warn('Health check warning:', err);
    }
  }

  // ==========================================
  // 3. Navigation
  // ==========================================
  function setupNavigation() {
    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        switchTab(targetTab);
      });
    });
  }

  function switchTab(tabId) {
    navTabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabId);
    });
    tabPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });
  }

  // ==========================================
  // 4. Profile Management
  // ==========================================
  async function loadProfile() {
    try {
      const res = await authFetch('/api/profile');
      const data = await res.json();
      if (data.success && data.profile) {
        state.profile = data.profile;
        populateProfileForm(data.profile);
      }
    } catch (err) {
      showToast('Error loading candidate profile', 'error');
    }
  }

  function populateProfileForm(p) {
    const ident = p.identity || {};
    document.getElementById('profName').value = ident.name || '';
    document.getElementById('profTitle').value = ident.title || '';
    document.getElementById('profEmail').value = ident.email || '';
    document.getElementById('profPhone').value = ident.phone || '';
    document.getElementById('profLocation').value = ident.location || '';
    document.getElementById('profLinkedin').value = ident.linkedin || '';
    document.getElementById('profSummary').value = ident.summary || '';

    const skills = p.skills || {};
    document.getElementById('profPrimarySkills').value = (skills.primary || []).join(', ');
    document.getElementById('profSecondarySkills').value = (skills.secondary || []).join(', ');

    const langs = (ident.languages || []).map(l => `${l.language} (${l.level})`).join(', ');
    document.getElementById('profLanguages').value = langs;
  }

  function setupProfileTab() {
    const btnSave = document.getElementById('btnSaveProfile');
    const btnParseCv = document.getElementById('btnParseCv');
    const cvFileInput = document.getElementById('cvFileInput');
    const cvDropzone = document.getElementById('cvDropzone');

    btnSave.addEventListener('click', async () => {
      const primaryArr = document.getElementById('profPrimarySkills').value.split(',').map(s => s.trim()).filter(Boolean);
      const secondaryArr = document.getElementById('profSecondarySkills').value.split(',').map(s => s.trim()).filter(Boolean);

      const updated = {
        ...state.profile,
        identity: {
          ...state.profile?.identity,
          name: document.getElementById('profName').value,
          title: document.getElementById('profTitle').value,
          email: document.getElementById('profEmail').value,
          phone: document.getElementById('profPhone').value,
          location: document.getElementById('profLocation').value,
          linkedin: document.getElementById('profLinkedin').value,
          summary: document.getElementById('profSummary').value
        },
        skills: {
          ...state.profile?.skills,
          primary: primaryArr,
          secondary: secondaryArr
        }
      };

      try {
        const res = await authFetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated)
        });
        const data = await res.json();
        if (data.success) {
          state.profile = data.profile;
          showToast('Profile saved successfully!', 'success');
        }
      } catch (err) {
        showToast('Failed to save profile', 'error');
      }
    });

    // Dropzone triggers file input
    cvDropzone.addEventListener('click', () => cvFileInput.click());
    cvFileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        await uploadCvFile(e.target.files[0]);
      }
    });

    btnParseCv.addEventListener('click', async () => {
      const rawText = document.getElementById('cvRawTextarea').value;
      if (!rawText || rawText.trim().length < 40) {
        showToast('Please enter your resume text first', 'error');
        return;
      }
      btnParseCv.disabled = true;
      btnParseCv.innerHTML = `<span class="spinner"></span> Parsing CV...`;

      try {
        const res = await authFetch('/api/profile/upload-cv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText })
        });
        const data = await res.json();
        if (data.success) {
          state.profile = data.profile;
          populateProfileForm(data.profile);
          showToast('Resume parsed and profile updated!', 'success');
        } else {
          showToast(data.error || 'Failed to parse resume', 'error');
        }
      } catch (err) {
        showToast('Error communicating with resume parser', 'error');
      } finally {
        btnParseCv.disabled = false;
        btnParseCv.innerHTML = `<span>Extract Profile with AI</span>`;
      }
    });
  }

  async function uploadCvFile(file) {
    const formData = new FormData();
    formData.append('cvFile', file);

    showToast(`Uploading and parsing ${file.name}...`);

    try {
      const res = await authFetch('/api/profile/upload-cv', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        state.profile = data.profile;
        populateProfileForm(data.profile);
        showToast('CV uploaded and profile updated successfully!', 'success');
      } else {
        showToast(data.error || 'Failed to parse uploaded CV', 'error');
      }
    } catch (err) {
      showToast('Error uploading CV file', 'error');
    }
  }

  // ==========================================
  // 5. Job Search & Scraper Tab with Pagination
  // ==========================================
  function setupSearchTab() {
    const btnSearch = document.getElementById('btnExecuteSearch');
    btnSearch.addEventListener('click', () => {
      const query = document.getElementById('searchQuery').value;
      const location = document.getElementById('searchLocation').value;
      const portal = document.getElementById('searchPortal').value;
      executeSearch(query, location, portal);
    });

    const pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        state.pageSize = parseInt(e.target.value, 10) || 12;
        state.currentPage = 1;
        renderCurrentJobPage();
      });
    }

    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (state.currentPage > 1) {
          state.currentPage--;
          renderCurrentJobPage(true);
        }
      });
    }
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        const maxPages = Math.ceil((state.allSearchResults || []).length / state.pageSize);
        if (state.currentPage < maxPages) {
          state.currentPage++;
          renderCurrentJobPage(true);
        }
      });
    }
  }

  async function executeInitialSearch() {
    await executeSearch('Software Engineer', 'Remote', 'freehire-search');
  }

  async function executeSearch(query, location, portal) {
    const btnSearch = document.getElementById('btnExecuteSearch');
    const resultsGrid = document.getElementById('jobResultsGrid');
    const resultsCount = document.getElementById('resultsCount');
    const paginationBar = document.getElementById('paginationBar');
    const paginationInfo = document.getElementById('paginationInfo');

    btnSearch.disabled = true;
    btnSearch.innerHTML = `<span class="spinner"></span> Fetching All Jobs...`;
    resultsGrid.innerHTML = `<div class="empty-state"><span class="spinner"></span><p>Fetching all available jobs from ${portal}...</p></div>`;
    if (paginationBar) paginationBar.classList.add('hidden');

    try {
      // Fetch batch of up to 100 jobs at once
      const url = `/api/scrape/search?query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&portal=${encodeURIComponent(portal)}&limit=100`;
      const res = await authFetch(url);
      const data = await res.json();

      if (data.success && data.jobs && data.jobs.length > 0) {
        state.allSearchResults = data.jobs;
        state.currentPage = 1;
        renderCurrentJobPage();
      } else {
        state.allSearchResults = [];
        resultsCount.textContent = '0 jobs found';
        if (paginationInfo) paginationInfo.textContent = 'Showing 0 of 0 jobs';
        resultsGrid.innerHTML = `
          <div class="empty-state">
            <h3>No Jobs Found</h3>
            <p>Try broadening your search keywords or switching to another portal.</p>
          </div>
        `;
      }
    } catch (err) {
      showToast('Job search failed', 'error');
      resultsGrid.innerHTML = `<div class="empty-state"><p>Error fetching search results.</p></div>`;
    } finally {
      btnSearch.disabled = false;
      btnSearch.innerHTML = `<span>Fetch All Jobs</span>`;
    }
  }

  function renderCurrentJobPage(scrollToTop = false) {
    const jobs = state.allSearchResults || [];
    const total = jobs.length;
    const pageSize = state.pageSize || 12;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIndex = (state.currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, total);
    const pagedJobs = jobs.slice(startIndex, endIndex);

    // Update Header Counts
    const resultsCount = document.getElementById('resultsCount');
    const paginationInfo = document.getElementById('paginationInfo');
    if (resultsCount) resultsCount.textContent = `Found ${total} live job openings`;
    if (paginationInfo) {
      paginationInfo.textContent = total > 0 
        ? `Showing ${startIndex + 1}–${endIndex} of ${total} jobs (Page ${state.currentPage} of ${totalPages})`
        : `Showing 0 of 0 jobs`;
    }

    // Render Cards for this page
    renderJobCards(pagedJobs);

    // Update Pagination Controls
    const paginationBar = document.getElementById('paginationBar');
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');
    const numbersContainer = document.getElementById('pageNumbersContainer');

    if (paginationBar) {
      if (totalPages > 1) {
        paginationBar.classList.remove('hidden');
      } else {
        paginationBar.classList.add('hidden');
      }
    }

    if (btnPrev) btnPrev.disabled = state.currentPage <= 1;
    if (btnNext) btnNext.disabled = state.currentPage >= totalPages;

    if (numbersContainer) {
      numbersContainer.innerHTML = '';
      for (let p = 1; p <= totalPages; p++) {
        // Show all if <= 7 pages, or smart ellipsis
        if (totalPages <= 7 || p === 1 || p === totalPages || (p >= state.currentPage - 1 && p <= state.currentPage + 1)) {
          const btn = document.createElement('button');
          btn.className = `page-num-btn ${p === state.currentPage ? 'active' : ''}`;
          btn.textContent = p;
          btn.addEventListener('click', () => {
            state.currentPage = p;
            renderCurrentJobPage(true);
          });
          numbersContainer.appendChild(btn);
        } else if (
          (p === state.currentPage - 2 && state.currentPage > 3) ||
          (p === state.currentPage + 2 && state.currentPage < totalPages - 2)
        ) {
          const span = document.createElement('span');
          span.className = 'page-ellipsis';
          span.textContent = '...';
          numbersContainer.appendChild(span);
        }
      }
    }

    if (scrollToTop) {
      document.querySelector('.search-results-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderJobCards(jobs) {
    const grid = document.getElementById('jobResultsGrid');
    grid.innerHTML = '';

    jobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'job-card';

      const skillsHtml = (job.skills || []).slice(0, 4).map(s => `<span class="meta-tag">${s}</span>`).join('');

      card.innerHTML = `
        <div class="job-card-top">
          <h4 class="job-card-title">${escapeHtml(job.title)}</h4>
          <span class="job-card-company">${escapeHtml(job.company)}</span>
          <div class="job-card-meta">
            <span class="meta-tag">${escapeHtml(job.location || 'Remote')}</span>
            <span class="meta-tag">${escapeHtml(job.seniority || 'Mid-Senior')}</span>
            ${skillsHtml}
          </div>
        </div>
        <div class="job-card-desc">${escapeHtml(job.description)}</div>
        <div class="job-card-footer">
          <span class="job-salary">${escapeHtml(job.salary || 'Competitive')}</span>
          <button class="btn btn-sm btn-primary btn-apply-job">
            <span>Analyze & Apply</span>
          </button>
        </div>
      `;

      card.querySelector('.btn-apply-job').addEventListener('click', () => {
        loadJobIntoApplyTab(job);
      });

      grid.appendChild(card);
    });
  }

  function loadJobIntoApplyTab(job) {
    state.currentJob = job;
    document.getElementById('targetCompany').value = job.company;
    document.getElementById('targetRole').value = job.title;
    document.getElementById('targetLocation').value = job.location;
    document.getElementById('targetDescription').value = job.description;

    switchTab('apply');
    showToast(`Loaded ${job.title} at ${job.company}`, 'success');

    // Automatically trigger Fit Evaluation
    evaluateCurrentJob();
  }

  // ==========================================
  // 6. 1-Click Apply & Generator Tab
  // ==========================================
  function setupApplyTab() {
    const btnEvaluate = document.getElementById('btnEvaluateFit');
    const btnGenerate = document.getElementById('btnGenerateAll');
    const btnDocCv = document.getElementById('btnDocCv');
    const btnDocCover = document.getElementById('btnDocCover');
    const btnToggleLatex = document.getElementById('btnToggleLatex');
    const btnRecompile = document.getElementById('btnRecompile');
    const btnDownload = document.getElementById('btnDownloadPdf');

    btnEvaluate.addEventListener('click', evaluateCurrentJob);
    btnGenerate.addEventListener('click', generateApplication);

    // Document switcher
    btnDocCv.addEventListener('click', () => switchDocumentView('cv'));
    btnDocCover.addEventListener('click', () => switchDocumentView('cover'));

    // Toggle LaTeX editor vs PDF
    btnToggleLatex.addEventListener('click', () => {
      state.isLatexView = !state.isLatexView;
      updateDocumentPreview();
    });

    // Recompile modified LaTeX
    btnRecompile.addEventListener('click', recompileCurrentLatex);

    // Download PDF
    btnDownload.addEventListener('click', () => {
      if (!state.currentApplication) {
        showToast('Generate an application first', 'error');
        return;
      }
      const type = state.activeDocType === 'cv' ? 'cv-pdf' : 'cover-pdf';
      const downloadUrl = `/api/apply/download/${state.currentApplication.id}/${type}?token=${encodeURIComponent(state.authToken)}`;
      window.location.href = downloadUrl;
    });
  }

  function getJobFromForm() {
    return {
      company: document.getElementById('targetCompany').value || 'Target Company',
      title: document.getElementById('targetRole').value || 'Software Engineer',
      location: document.getElementById('targetLocation').value || 'Remote',
      description: document.getElementById('targetDescription').value
    };
  }

  async function evaluateCurrentJob() {
    const job = getJobFromForm();
    if (!job.description || job.description.trim().length < 30) {
      showToast('Please paste a job description first', 'error');
      return;
    }

    const btnEvaluate = document.getElementById('btnEvaluateFit');
    btnEvaluate.disabled = true;
    btnEvaluate.innerHTML = `<span class="spinner"></span> Evaluating...`;

    try {
      const res = await authFetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job })
      });
      const data = await res.json();
      if (data.success && data.evaluation) {
        state.currentFitEvaluation = data.evaluation;
        renderFitEvaluation(data.evaluation);
        showToast(`Fit Evaluation: ${data.evaluation.verdict} (${data.evaluation.overallScore}%)`, 'success');
      }
    } catch (err) {
      showToast('Evaluation failed', 'error');
    } finally {
      btnEvaluate.disabled = false;
      btnEvaluate.innerHTML = `<span>Run Fit Evaluation</span>`;
    }
  }

  function renderFitEvaluation(ev) {
    const evalCard = document.getElementById('evaluationCard');
    evalCard.classList.remove('hidden');

    // Overall Score
    const overallScoreBadge = document.getElementById('overallScoreBadge');
    const scoreVal = ev.overallScore || 90;
    overallScoreBadge.className = `score-badge ${scoreVal >= 80 ? 'score-high' : scoreVal >= 60 ? 'score-mid' : 'score-low'}`;
    overallScoreBadge.querySelector('.score-val').textContent = `${scoreVal}%`;
    overallScoreBadge.querySelector('.score-lbl').textContent = ev.verdict || 'Match';

    // Gating Badges
    const elig = ev.eligibilityGate || { status: 'PASS', note: 'Open' };
    const lang = ev.languageGate || { status: 'PASS', note: 'Matches' };

    const eligBadge = document.getElementById('eligibilityGateBadge');
    eligBadge.className = `gate-pill ${elig.status.toLowerCase()}`;
    eligBadge.innerHTML = `<span class="gate-icon">${elig.status === 'PASS' ? '✓' : '!'}</span><span>Eligibility: ${elig.status}</span>`;

    const langBadge = document.getElementById('languageGateBadge');
    langBadge.className = `gate-pill ${lang.status.toLowerCase()}`;
    langBadge.innerHTML = `<span class="gate-icon">${lang.status === 'PASS' ? '✓' : '!'}</span><span>Language: ${lang.status}</span>`;

    // 5 Dimension Bars
    const dimContainer = document.getElementById('dimensionBars');
    dimContainer.innerHTML = '';
    const dims = ev.dimensions || {};

    const dimLabels = {
      technicalMatch: '1. Technical Skills Match',
      experienceMatch: '2. Experience & Functional Match',
      seniorityMatch: '3. Seniority & Scope Match',
      growthMatch: '4. Growth & Career Trajectory',
      domainMatch: '5. Domain & Culture Alignment'
    };

    Object.entries(dimLabels).forEach(([key, label]) => {
      const dimData = dims[key] || { score: 85, analysis: '' };
      const item = document.createElement('div');
      item.className = 'dim-item';
      item.innerHTML = `
        <div class="dim-label-row">
          <span class="dim-name">${label}</span>
          <span class="dim-score">${dimData.score}%</span>
        </div>
        <div class="dim-bar-track">
          <div class="dim-bar-fill" style="width: ${dimData.score}%"></div>
        </div>
      `;
      dimContainer.appendChild(item);
    });

    // Strengths & Gaps
    const strengthsList = document.getElementById('evalStrengthsList');
    const gapsList = document.getElementById('evalGapsList');
    strengthsList.innerHTML = (ev.strengths || ['Strong tech stack match', 'Proven high scale experience']).map(s => `<li>${escapeHtml(s)}</li>`).join('');
    gapsList.innerHTML = (ev.gaps || ['Specific company internal tooling']).map(g => `<li>${escapeHtml(g)}</li>`).join('');
  }

  async function generateApplication() {
    const job = getJobFromForm();
    if (!job.description || job.description.trim().length < 30) {
      showToast('Please enter a job description first', 'error');
      return;
    }

    const btnGenerate = document.getElementById('btnGenerateAll');
    const pipelineCard = document.getElementById('pipelineStatusCard');

    btnGenerate.disabled = true;
    btnGenerate.innerHTML = `<span class="spinner"></span> Generating Application...`;
    pipelineCard.classList.remove('hidden');

    // Simulate animated step progression
    animatePipelineStep('step-drafter');

    try {
      setTimeout(() => animatePipelineStep('step-reviewer'), 1200);
      setTimeout(() => animatePipelineStep('step-latex'), 2500);
      setTimeout(() => animatePipelineStep('step-ats'), 3600);

      const res = await authFetch('/api/apply/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job,
          fitEvaluation: state.currentFitEvaluation
        })
      });

      const data = await res.json();
      if (data.success) {
        state.currentApplication = data.application;
        state.cvPdfBase64 = data.cvPdfBase64;
        state.coverPdfBase64 = data.coverPdfBase64;
        state.cvLatex = data.application.cvLatex;
        state.coverLatex = data.application.coverLetterLatex;

        completePipelineSteps();
        updateDocumentPreview();
        await loadTrackerApplications();

        showToast('Tailored CV and Cover Letter created successfully!', 'success');
      } else {
        showToast(data.error || 'Generation failed', 'error');
      }
    } catch (err) {
      showToast('Generation error occurred', 'error');
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.innerHTML = `<span>Generate Tailored Application</span>`;
    }
  }

  function animatePipelineStep(stepId) {
    document.querySelectorAll('.pipeline-step').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(stepId);
    if (target) target.classList.add('active');
  }

  function completePipelineSteps() {
    document.querySelectorAll('.pipeline-step').forEach(el => {
      el.classList.remove('active');
      el.classList.add('done');
    });
  }

  function switchDocumentView(docType) {
    state.activeDocType = docType;
    document.getElementById('btnDocCv').classList.toggle('active', docType === 'cv');
    document.getElementById('btnDocCover').classList.toggle('active', docType === 'cover');
    document.getElementById('texFileName').textContent = docType === 'cv' ? 'main.tex' : 'cover.tex';

    updateDocumentPreview();
  }

  function updateDocumentPreview() {
    const emptyState = document.getElementById('docEmptyState');
    const pdfContainer = document.getElementById('pdfContainer');
    const latexContainer = document.getElementById('latexEditorContainer');
    const btnToggleLatex = document.getElementById('btnToggleLatex');
    const btnRecompile = document.getElementById('btnRecompile');
    const reviewerFooter = document.getElementById('reviewerFooter');
    const pdfFrame = document.getElementById('pdfViewerFrame');
    const latexTextarea = document.getElementById('latexSourceTextarea');

    if (!state.currentApplication) {
      emptyState.classList.remove('hidden');
      pdfContainer.classList.add('hidden');
      latexContainer.classList.add('hidden');
      reviewerFooter.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    reviewerFooter.classList.remove('hidden');

    const currentPdf = state.activeDocType === 'cv' ? state.cvPdfBase64 : state.coverPdfBase64;
    const currentLatex = state.activeDocType === 'cv' ? state.cvLatex : state.coverLatex;

    latexTextarea.value = currentLatex || '';

    if (state.isLatexView) {
      pdfContainer.classList.add('hidden');
      latexContainer.classList.remove('hidden');
      btnRecompile.classList.remove('hidden');
      btnToggleLatex.innerHTML = `<span>View PDF Preview</span>`;
    } else {
      latexContainer.classList.add('hidden');
      pdfContainer.classList.remove('hidden');
      btnRecompile.classList.add('hidden');
      btnToggleLatex.innerHTML = `<span>View LaTeX Source</span>`;

      if (currentPdf) {
        pdfFrame.src = `data:application/pdf;base64,${currentPdf}#toolbar=0&navpanes=0`;
      }
    }
  }

  async function recompileCurrentLatex() {
    const latexContent = document.getElementById('latexSourceTextarea').value;
    const type = state.activeDocType;
    const btnRecompile = document.getElementById('btnRecompile');

    btnRecompile.disabled = true;
    btnRecompile.innerHTML = `<span class="spinner"></span> Compiling...`;

    try {
      const res = await authFetch('/api/apply/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          latexContent,
          appId: state.currentApplication?.id
        })
      });
      const data = await res.json();
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
        showToast('LaTeX compiled successfully!', 'success');
      }
    } catch (err) {
      showToast('Recompilation error', 'error');
    } finally {
      btnRecompile.disabled = false;
      btnRecompile.innerHTML = `<span>Recompile</span>`;
    }
  }

  // ==========================================
  // 7. Interview Prep Tab
  // ==========================================
  function setupInterviewTab() {
    const btnGen = document.getElementById('btnGenerateInterview');
    btnGen.addEventListener('click', generateInterviewQuestions);
  }

  async function generateInterviewQuestions() {
    const job = getJobFromForm();
    const btnGen = document.getElementById('btnGenerateInterview');
    const content = document.getElementById('interviewContent');

    btnGen.disabled = true;
    btnGen.innerHTML = `<span class="spinner"></span> Generating Prep...`;
    content.innerHTML = `<div class="empty-state"><span class="spinner"></span><p>Building STAR responses and tactical questions for ${escapeHtml(job.company)}...</p></div>`;

    try {
      const res = await authFetch('/api/interview/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job })
      });
      const data = await res.json();
      if (data.success && data.prep) {
        renderInterviewCards(data.prep);
        showToast('Interview preparation generated!', 'success');
      }
    } catch (err) {
      showToast('Failed to generate interview prep', 'error');
    } finally {
      btnGen.disabled = false;
      btnGen.innerHTML = `<span>Generate Questions for Current Job</span>`;
    }
  }

  function renderInterviewCards(prep) {
    const container = document.getElementById('interviewContent');
    container.innerHTML = '';

    // STAR Questions
    const starSection = document.createElement('div');
    starSection.innerHTML = `<h4 style="font-size: 15px; margin-bottom: 14px; font-weight: 700;">Tailored Behavioral & Technical STAR Answers</h4>`;

    (prep.starQuestions || []).forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'star-card';
      card.innerHTML = `
        <div class="star-question">Q${idx + 1}: ${escapeHtml(q.question)}</div>
        <div class="star-grid">
          <div class="star-part">
            <h5>Situation</h5>
            <p>${escapeHtml(q.situation)}</p>
          </div>
          <div class="star-part">
            <h5>Task</h5>
            <p>${escapeHtml(q.task)}</p>
          </div>
          <div class="star-part">
            <h5>Action</h5>
            <p>${escapeHtml(q.action)}</p>
          </div>
          <div class="star-part">
            <h5>Result</h5>
            <p>${escapeHtml(q.result)}</p>
          </div>
        </div>
      `;
      starSection.appendChild(card);
    });

    container.appendChild(starSection);

    // Questions to Ask
    const askSection = document.createElement('div');
    askSection.style.marginTop = '24px';
    askSection.innerHTML = `<h4 style="font-size: 15px; margin-bottom: 14px; font-weight: 700;">Strategic Questions to Ask the Interviewer</h4>`;

    (prep.questionsToAsk || []).forEach(item => {
      const box = document.createElement('div');
      box.className = 'eval-box';
      box.style.marginBottom = '10px';
      box.innerHTML = `
        <h4 style="color: var(--text-primary); font-size: 13px;">"${escapeHtml(item.question)}"</h4>
        <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;"><strong>Why ask this:</strong> ${escapeHtml(item.rationale)}</p>
      `;
      askSection.appendChild(box);
    });

    container.appendChild(askSection);
  }

  // ==========================================
  // 8. Tracker Tab (Kanban)
  // ==========================================
  function setupTrackerTab() {}

  async function loadTrackerApplications() {
    try {
      const res = await authFetch('/api/tracker');
      const data = await res.json();
      if (data.success && data.applications) {
        renderKanban(data.applications);
      }
    } catch (err) {
      console.warn('Error loading tracker applications:', err);
    }
  }

  function renderKanban(apps) {
    const cols = {
      Drafted: document.getElementById('col-Drafted'),
      Applied: document.getElementById('col-Applied'),
      Interviewing: document.getElementById('col-Interviewing'),
      Offer: document.getElementById('col-Offer')
    };

    const counts = { Drafted: 0, Applied: 0, Interviewing: 0, Offer: 0 };

    Object.values(cols).forEach(col => { if (col) col.innerHTML = ''; });

    apps.forEach(app => {
      const status = app.status || 'Drafted';
      if (counts[status] !== undefined) counts[status]++;

      const col = cols[status] || cols['Drafted'];
      if (!col) return;

      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.innerHTML = `
        <h4>${escapeHtml(app.jobTitle || 'Role')}</h4>
        <div class="company">${escapeHtml(app.company || 'Company')}</div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
          <span>Fit: ${app.fitScore || 90}%</span>
          <span>${new Date(app.createdAt || Date.now()).toLocaleDateString()}</span>
        </div>
      `;

      col.appendChild(card);
    });

    Object.entries(counts).forEach(([status, count]) => {
      const pill = document.getElementById(`count-${status}`);
      if (pill) pill.textContent = count;
    });
  }

  // ==========================================
  // 9. Utilities
  // ==========================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Launch App
  init();
});
