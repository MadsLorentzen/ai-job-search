import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { ROOT_DIR } from '../config/env.js';

const SKILLS_DIR = path.join(ROOT_DIR, '.agents/skills');
const FREEHIRE_PAGE_SIZE = 50;
const FREEHIRE_MAX_PAGES = 8;
const LINKEDIN_MAX_PAGES = 5;

/**
 * Portals the app knows how to describe.
 *
 * `getAvailablePortals()` filters this to the ones that can actually run, so
 * the UI cannot offer a portal that silently falls back to sample data. Two
 * entries (jobindex, jobnet) were previously advertised with no CLI behind
 * them at all: every search against them returned invented postings.
 */
const KNOWN_PORTALS = [
  { id: 'freehire-search', name: 'FreeHire (Global Tech & Remote)', defaultLocation: 'Remote', global: true, direct: true },
  { id: 'linkedin-search', name: 'LinkedIn (Global Public Postings)', defaultLocation: 'Remote', global: true, direct: true },
  { id: 'jobbank-search', name: 'Akademikernes Jobbank (Academic/Graduate)', defaultLocation: 'Danmark', global: false },
  { id: 'jobdanmark-search', name: 'Jobdanmark (Regional Denmark)', defaultLocation: 'Sjælland', global: false }
];

function cliPathFor(portal) {
  return path.join(SKILLS_DIR, portal, 'cli/src/cli.ts');
}

/** Stable id derived from content, so the same posting keeps its id across runs. */
function stableId(portal, { url, company, title }) {
  const basis = url || `${portal}|${company || ''}|${title || ''}`;
  return `${portal}-${crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16)}`;
}

export const scraperService = {
  getAvailablePortals() {
    return KNOWN_PORTALS
      .filter(p => p.direct || fs.existsSync(cliPathFor(p.id)))
      .map(({ direct, ...rest }) => rest);
  },

  isPortalAvailable(portal) {
    return this.getAvailablePortals().some(p => p.id === portal);
  },

  async searchJobs({ query = '', location = 'Remote', portal = 'freehire-search', remote = 'all' }) {
    if (!this.isPortalAvailable(portal)) {
      const err = new Error(`Unknown or unavailable portal "${portal}".`);
      err.statusCode = 400;
      throw err;
    }

    if (portal === 'freehire-search') {
      try {
        const results = await this.fetchFreehireDirect({ query, location });
        if (results.length) return { jobs: results, isSample: false, source: 'freehire-api' };
      } catch (err) {
        console.warn('FreeHire direct fetch failed, trying CLI:', err.message);
      }
    }

    if (portal === 'linkedin-search') {
      try {
        const results = await this.fetchLinkedinDirect({ query, location });
        if (results.length) return { jobs: results, isSample: false, source: 'linkedin-guest' };
      } catch (err) {
        console.warn('LinkedIn direct fetch failed, trying CLI:', err.message);
      }
    }

    const skillCliPath = cliPathFor(portal);
    if (fs.existsSync(skillCliPath)) {
      try {
        const results = await this.runBunCli(portal, skillCliPath, { query, location, remote });
        if (results.length) return { jobs: results, isSample: false, source: `${portal}-cli` };
      } catch (err) {
        console.warn(`Bun CLI for ${portal} failed:`, err.message);
      }
    }

    // Nothing reachable. Return an empty result rather than sample data
    // dressed up as live postings.
    return {
      jobs: [],
      isSample: false,
      source: 'none',
      warning: `No results. ${portal} could not be reached, or it returned nothing for this query.`
    };
  },

  runBunCli(portal, scriptPath, { query, location, remote }) {
    return new Promise((resolve, reject) => {
      const args = ['run', scriptPath, 'search'];

      if (portal === 'linkedin-search') {
        const searchLoc = (!location || location.toLowerCase() === 'remote') ? 'United States' : location;
        args.push('-l', searchLoc);
        if (query) args.push('-q', query);
        if (location && location.toLowerCase() === 'remote') args.push('--remote', 'remote');
        else if (remote && remote !== 'all') args.push('--remote', remote);
        args.push('--format', 'json');
      } else if (portal === 'freehire-search') {
        if (query) args.push('-q', query);
        if (location && !['remote', 'all'].includes(location.toLowerCase())) args.push('--country', location);
      } else {
        if (query) args.push('-q', query);
        if (location) args.push('-l', location);
        args.push('--format', 'json');
      }

      const proc = spawn('bun', args, { cwd: ROOT_DIR });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        finish(reject, new Error('Portal CLI timed out after 45s'));
      }, 45000);

      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => finish(reject, err));

      proc.on('close', code => {
        if (code !== 0 && !stdout) {
          return finish(reject, new Error(`Process exited with code ${code}: ${stderr.slice(0, 400)}`));
        }
        try {
          const startIdx = stdout.indexOf('[');
          const endIdx = stdout.lastIndexOf(']');
          if (startIdx === -1 || endIdx <= startIdx) return finish(resolve, []);

          const parsed = JSON.parse(stdout.slice(startIdx, endIdx + 1));
          const list = Array.isArray(parsed) ? parsed : (parsed.jobs || parsed.results || []);
          finish(resolve, this.dedupe(list.map(job => this.normalizeJob(job, portal))));
        } catch (parseErr) {
          console.warn('Could not parse portal CLI output:', parseErr.message);
          finish(resolve, []);
        }
      });
    });
  },

  async fetchFreehireDirect({ query, location }) {
    const baseUrl = process.env.FREEHIRE_API_URL || 'https://freehire.me';
    let allJobs = [];

    for (let page = 1; page <= FREEHIRE_MAX_PAGES; page++) {
      let url = `${baseUrl}/api/v1/jobs?page=${page}&limit=${FREEHIRE_PAGE_SIZE}`;
      if (query?.trim()) url += `&q=${encodeURIComponent(query.trim())}`;
      if (location && !['remote', 'all'].includes(location.toLowerCase())) {
        url += `&country=${encodeURIComponent(location.trim())}`;
      }

      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'AIJobSearch/2.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) break;

      const data = await response.json();
      const jobs = data.jobs || data.data || data.results || (Array.isArray(data) ? data : []);
      if (!jobs.length) break;

      allJobs = allJobs.concat(jobs);
      // Compare against the size actually requested. The old check used a
      // hardcoded 20 against a limit of 50, so the last page triggered a
      // pointless extra round trip.
      if (jobs.length < FREEHIRE_PAGE_SIZE) break;
    }

    return this.dedupe(allJobs.map(j => this.normalizeJob(j, 'freehire-search')));
  },

  async fetchLinkedinDirect({ query, location }) {
    const searchLoc = (!location || location.toLowerCase() === 'remote') ? 'United States' : location;
    const isRemote = !location || location.toLowerCase() === 'remote';
    const allJobs = [];
    let start = 0;

    for (let page = 0; page < LINKEDIN_MAX_PAGES; page++) {
      let url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query || 'Software')}&location=${encodeURIComponent(searchLoc)}&start=${start}`;
      if (isRemote) url += '&f_WT=2';

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'X-Requested-With': 'XMLHttpRequest'
        },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) break;

      const html = await response.text();
      const cardRegex = /<li[\s\S]*?<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>[\s\S]*?<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*class="[^"]*base-card__full-link[^"]*"[\s\S]*?<\/li>/gi;

      let match;
      let pageFound = 0;

      while ((match = cardRegex.exec(html)) !== null) {
        const title = this.stripHtml(match[1]);
        const company = this.stripHtml(match[2]);
        const jobLocation = this.stripHtml(match[3]);
        const jobUrl = match[4].split('?')[0];
        pageFound++;

        if (title && company) {
          allJobs.push({
            id: stableId('linkedin-search', { url: jobUrl, company, title }),
            title,
            company,
            location: jobLocation || location || '',
            url: jobUrl,
            portal: 'linkedin-search',
            postedDate: '',
            description: `${title} at ${company}. Location: ${jobLocation || 'not stated'}.\n\nFull description at: ${jobUrl}`,
            descriptionTruncated: true,
            skills: [],
            seniority: '',
            employmentType: '',
            salary: ''
          });
        }
      }

      if (pageFound === 0) break;
      // Advance by what this page actually returned. Advancing by a fixed 25
      // while the endpoint serves ~10 per call skipped most of the results.
      start += pageFound;
    }

    return this.dedupe(allJobs);
  },

  stripHtml(html) {
    return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  },

  dedupe(jobs) {
    const seen = new Set();
    return jobs.filter(job => {
      if (seen.has(job.id)) return false;
      seen.add(job.id);
      return true;
    });
  },

  /**
   * Map a portal payload onto the app's shape.
   * Missing values stay empty: filling them with plausible defaults (a fake
   * salary, an invented skill list) made fabricated data indistinguishable
   * from real data downstream.
   */
  normalizeJob(raw, portal) {
    const title = raw.title || raw.job_title || '';
    const company = raw.company || raw.company_name || raw.employer || '';
    const url = raw.url || raw.link || raw.apply_url ||
      (raw.slug ? `https://freehire.me/job/${raw.slug}` : '');

    return {
      id: raw.id || raw.slug || stableId(portal, { url, company, title }),
      title,
      company,
      location: raw.location || raw.city || raw.region || '',
      url,
      portal,
      postedDate: raw.posted_date || raw.date || raw.created_at || '',
      description: raw.description || raw.body || raw.summary || '',
      skills: Array.isArray(raw.skills) ? raw.skills : (Array.isArray(raw.tags) ? raw.tags : []),
      seniority: raw.seniority || raw.level || '',
      employmentType: raw.employment_type || raw.type || '',
      salary: raw.salary || raw.compensation || ''
    };
  }
};
