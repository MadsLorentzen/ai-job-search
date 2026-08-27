import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { ROOT_DIR } from '../config/env.js';
import { loggerFor } from '../config/logger.js';
import { ValidationError } from '../errors.js';

const log = loggerFor('scraper');

const SKILLS_DIR = path.join(ROOT_DIR, '.agents/skills');
const FREEHIRE_PAGE_SIZE = 50;
const FREEHIRE_MAX_PAGES = 8;
const LINKEDIN_MAX_PAGES = 5;

/**
 * Portals the app knows how to describe.
 *
 * `getAvailablePortals()` filters this to the ones whose CLI is actually
 * present, so the UI cannot offer a portal that cannot run. Previously an
 * unreachable portal (a missing CLI, or bun not installed) fell through to a
 * hardcoded sample list and returned invented postings under success: true.
 */
const KNOWN_PORTALS = [
  { id: 'freehire-search', name: 'FreeHire (Global Tech & Remote)', defaultLocation: 'Remote', global: true, direct: true },
  { id: 'linkedin-search', name: 'LinkedIn (Global Public Postings)', defaultLocation: 'Remote', global: true, direct: true },
  { id: 'jobindex-search', name: 'Jobindex (Denmark)', defaultLocation: 'København', global: false },
  { id: 'jobnet-search', name: 'Jobnet / STAR (Danish Public Employment)', defaultLocation: 'Danmark', global: false },
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
      throw new ValidationError(`Unknown or unavailable portal "${portal}".`);
    }

    if (portal === 'freehire-search') {
      try {
        const results = await this.fetchFreehireDirect({ query, location });
        if (results.length) return { jobs: results, isSample: false, source: 'freehire-api' };
      } catch (err) {
        log.warn({ err: err.message }, 'FreeHire direct fetch failed, trying CLI');
      }
    }

    if (portal === 'linkedin-search') {
      try {
        const results = await this.fetchLinkedinDirect({ query, location });
        if (results.length) return { jobs: results, isSample: false, source: 'linkedin-guest' };
      } catch (err) {
        log.warn({ err: err.message }, 'LinkedIn direct fetch failed, trying CLI');
      }
    }

    const skillCliPath = cliPathFor(portal);
    if (fs.existsSync(skillCliPath)) {
      try {
        const results = await this.runBunCli(portal, skillCliPath, { query, location, remote });
        if (results.length) return { jobs: results, isSample: false, source: `${portal}-cli` };
      } catch (err) {
        log.warn({ portal, err: err.message }, 'portal CLI failed');
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
          log.warn({ err: parseErr.message }, 'could not parse portal CLI output');
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

      const cards = this.parseLinkedinCards(await response.text());
      const pageFound = cards.length;

      for (const card of cards) {
        allJobs.push({
          id: stableId('linkedin-search', card),
          title: card.title,
          company: card.company,
          location: card.location || location || '',
          url: card.url,
          portal: 'linkedin-search',
          postedDate: '',
          description: `${card.title} at ${card.company}. Location: ${card.location || 'not stated'}.\n\nFull description at: ${card.url}`,
          descriptionTruncated: true,
          skills: [],
          seniority: '',
          employmentType: '',
          salary: ''
        });
      }

      if (pageFound === 0) break;
      // Advance by what this page actually returned. Advancing by a fixed 25
      // while the endpoint serves ~10 per call skipped most of the results.
      start += pageFound;
    }

    return this.dedupe(allJobs);
  },

  /**
   * Parse job cards out of LinkedIn's guest listing HTML.
   *
   * Extracted so the tests exercise the same code the fetcher runs; a test
   * that re-declares the regex can pass while the real parser is broken.
   *
   * Each field is matched within a card independently rather than as one
   * long ordered chain. The previous single regex required the anchor's
   * href to appear before its class attribute, so a markup reshuffle that
   * changed nothing meaningful would silently return zero results.
   */
  parseLinkedinCards(html) {
    const cards = [];
    const blocks = String(html || '').split(/<li[\s>]/i).slice(1);

    for (const block of blocks) {
      const pick = (pattern) => block.match(pattern)?.[1];

      const title = pick(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
      const company = pick(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i);
      const location = pick(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

      // Accept either attribute order on the link.
      const anchor = block.match(/<a\b[^>]*base-card__full-link[^>]*>/i)?.[0] || '';
      const url = anchor.match(/href="([^"]+)"/i)?.[1];

      if (!title || !company || !url) continue;

      cards.push({
        title: this.stripHtml(title),
        company: this.stripHtml(company),
        location: this.stripHtml(location || ''),
        url: url.split('?')[0]
      });
    }

    return cards;
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
  },

  /**
   * Whether a portal CLI can be run at all. The CLIs are Bun/TypeScript, so
   * without bun on PATH the detail fetch cannot work and callers should say so
   * rather than silently returning a stub.
   */
  hasBun() {
    if (this._hasBun !== undefined) return this._hasBun;
    this._hasBun = (process.env.PATH || '').split(path.delimiter).some(dir => {
      try {
        return dir && fs.existsSync(path.join(dir, 'bun'));
      } catch {
        return false;
      }
    });
    return this._hasBun;
  },

  /**
   * Fetch a posting's full text via the portal skill's own `detail` command.
   *
   * Search endpoints return a stub for several portals (LinkedIn's guest
   * listing carries only a title, company and location), and evaluating a job
   * from that produces a score with almost nothing behind it. Every portal
   * skill in this repo ships a `detail <id|url>` command; none of them were
   * being called.
   */
  async fetchJobDetail({ portal, url, id }) {
    if (!this.isPortalAvailable(portal)) {
      throw new ValidationError(`Unknown or unavailable portal "${portal}".`);
    }

    const scriptPath = cliPathFor(portal);
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, reason: `No detail command available for ${portal}.` };
    }
    if (!this.hasBun()) {
      return { ok: false, reason: 'bun is not installed, so portal detail pages cannot be fetched. Paste the description manually.' };
    }

    const target = url || id;
    if (!target) return { ok: false, reason: 'A job URL or id is required.' };

    try {
      const raw = await this.runPortalCommand(portal, scriptPath, ['detail', target, '--format', 'json']);
      const parsed = this.parseDetailOutput(raw);
      if (!parsed) return { ok: false, reason: 'The portal returned no readable detail for this posting.' };
      return { ok: true, detail: parsed };
    } catch (err) {
      log.warn({ portal, err: err.message }, 'detail fetch failed');

      // A portal CLI that has never had `bun install` run in its directory
      // fails with a module-resolution error, which is fixable but says
      // nothing useful on its own.
      if (/cannot find module|failed to resolve/i.test(err.message)) {
        return {
          ok: false,
          reason: `The ${portal} CLI has no dependencies installed. Run: cd .agents/skills/${portal}/cli && bun install`
        };
      }
      return { ok: false, reason: `Could not fetch the posting: ${err.message.slice(0, 200)}` };
    }
  },

  parseDetailOutput(stdout) {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end <= start) return null;

    let parsed;
    try {
      parsed = JSON.parse(stdout.slice(start, end + 1));
    } catch {
      return null;
    }

    const body = parsed.job || parsed.detail || parsed;
    const description = body.description || body.body || body.content || body.text || '';
    if (!description || !String(description).trim()) return null;

    return {
      title: body.title || '',
      company: body.company || body.company_name || body.employer || '',
      location: body.location || body.city || '',
      url: body.url || body.link || '',
      description: String(description),
      postedDate: body.posted_date || body.published || body.date || '',
      deadline: body.deadline || body.application_deadline || '',
      employmentType: body.employment_type || body.type || ''
    };
  },

  /** Spawn a portal CLI with arbitrary arguments and return raw stdout. */
  runPortalCommand(portal, scriptPath, commandArgs, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const proc = spawn('bun', ['run', scriptPath, ...commandArgs], { cwd: ROOT_DIR });

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
        finish(reject, new Error(`${portal} CLI timed out`));
      }, timeoutMs);

      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => finish(reject, err));
      proc.on('close', code => {
        if (code !== 0 && !stdout) {
          return finish(reject, new Error(stderr.slice(0, 200) || `exited with code ${code}`));
        }
        finish(resolve, stdout);
      });
    });
  }
};
