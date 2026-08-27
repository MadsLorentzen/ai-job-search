/**
 * First-run wizard.
 *
 * The app used to ship a fictional profile, which fed invented achievements
 * into generated CVs. Removing it was correct but left a new user on a blank
 * form with no indication of what to do first. Three steps: import a CV,
 * confirm what was parsed, say what you are looking for.
 *
 * Confirming parsed fields is deliberately its own step. It is the one moment
 * the user still has the source document in mind and can catch an extraction
 * error before it reaches a document sent to an employer.
 */
import { api } from './api.js';
import { $, showToast, trapFocus } from './ui.js';

export class Onboarding {
  constructor({ onComplete, portals = [] }) {
    this.onComplete = onComplete;
    this.portals = portals;
    this.step = 1;
    this.parsed = null;
    this.releaseFocus = null;
  }

  get overlay() {
    return $('onboardingOverlay');
  }

  start() {
    this.populatePortals();
    this.bind();
    this.overlay.classList.remove('hidden');
    this.releaseFocus = trapFocus(this.overlay);
    this.goTo(1);
    $('obDropzone')?.focus();
  }

  close() {
    this.overlay.classList.add('hidden');
    this.releaseFocus?.();
    this.releaseFocus = null;
  }

  populatePortals() {
    const select = $('obPortal');
    if (!select) return;
    select.innerHTML = this.portals
      .map(p => `<option value="${p.id}">${p.name}</option>`)
      .join('');
  }

  goTo(step) {
    this.step = step;
    [1, 2, 3].forEach(n => {
      $(`obStep${n}`)?.classList.toggle('hidden', n !== step);
      document.querySelector(`.ob-step[data-step="${n}"]`)?.classList.toggle('active', n <= step);
    });

    const subtitle = {
      1: 'Step 1 of 3 · Upload your CV',
      2: 'Step 2 of 3 · Check what we read',
      3: 'Step 3 of 3 · What are you looking for?'
    }[step];
    $('onboardingSubtitle').textContent = subtitle;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;

    const dropzone = $('obDropzone');
    const fileInput = $('obFileInput');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach(evt =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      }));
    ['dragleave', 'drop'].forEach(evt =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      }));

    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) this.parseFile(file);
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.parseFile(file);
      fileInput.value = '';
    });

    $('obParse').addEventListener('click', () => {
      const text = $('obRawText').value.trim();
      if (text.length >= 40) return this.parseText(text);
      showToast('Upload a CV file or paste at least a few lines of text.', 'error');
    });

    $('obSkip').addEventListener('click', () => this.finish({ skipped: true }));
    $('obBack2').addEventListener('click', () => this.goTo(1));
    $('obBack3').addEventListener('click', () => this.goTo(2));
    $('obConfirm').addEventListener('click', () => this.goTo(3));
    $('obFinish').addEventListener('click', () => this.finish({ skipped: false }));
  }

  async parseFile(file) {
    const formData = new FormData();
    formData.append('cvFile', file);
    await this.runParse(() => api.form('/api/profile/parse-cv', formData), file.name);
  }

  async parseText(rawText) {
    await this.runParse(() => api.post('/api/profile/parse-cv', { rawText }), 'your text');
  }

  async runParse(request, label) {
    const button = $('obParse');
    button.disabled = true;
    button.textContent = 'Reading...';

    try {
      const data = await request();
      if (!data.success) {
        showToast(data.error || 'Could not read that CV.', 'error');
        return;
      }

      this.parsed = data.parsed;
      this.fillConfirmStep(data.parsed);
      $('obParseNote').textContent = data.message ||
        `Read from ${label}. Check every field before continuing.`;
      this.goTo(2);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Continue';
    }
  }

  fillConfirmStep(parsed) {
    const identity = parsed.identity || {};
    $('obName').value = identity.name || '';
    $('obTitle').value = identity.title || '';
    $('obEmail').value = identity.email || '';
    $('obPhone').value = identity.phone || '';
    $('obLocation').value = identity.location || '';
    $('obSkills').value = (parsed.skills?.primary || []).join(', ');
  }

  async finish({ skipped }) {
    const button = $('obFinish');
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving...';
    }

    try {
      const existing = (await api.get('/api/profile')).profile;

      const profile = {
        ...existing,
        ...(skipped ? {} : this.parsed || {}),
        identity: {
          ...existing.identity,
          ...(skipped ? {} : this.parsed?.identity || {}),
          ...(skipped ? {} : {
            name: $('obName').value.trim(),
            title: $('obTitle').value.trim(),
            email: $('obEmail').value.trim(),
            phone: $('obPhone').value.trim(),
            location: $('obLocation').value.trim()
          })
        },
        skills: {
          ...existing.skills,
          ...(skipped ? {} : this.parsed?.skills || {}),
          ...(skipped ? {} : {
            primary: $('obSkills').value.split(',').map(s => s.trim()).filter(Boolean)
          })
        },
        targetQueries: skipped ? existing.targetQueries : [{
          query: $('obQuery').value.trim(),
          location: $('obLocationPref').value.trim(),
          portal: $('obPortal').value
        }].filter(q => q.query || q.location),
        onboardingComplete: true
      };
      delete profile.source;

      const saved = await api.post('/api/profile', profile);
      this.close();
      showToast(skipped ? 'Set up later from the Profile tab.' : 'Profile saved.', 'success');
      this.onComplete?.(saved.profile);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Finish setup';
      }
    }
  }
}
