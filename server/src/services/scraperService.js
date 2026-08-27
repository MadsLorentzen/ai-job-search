import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { storageService } from './storageService.js';

const ROOT_DIR = storageService.getRootDir();

export const scraperService = {
  getAvailablePortals() {
    return [
      { id: 'freehire-search', name: 'FreeHire (Global Tech & Remote Aggregator)', defaultLocation: 'Remote', global: true },
      { id: 'linkedin-search', name: 'LinkedIn (Global Public Postings)', defaultLocation: 'Remote', global: true },
      { id: 'jobindex-search', name: 'Jobindex (Denmark)', defaultLocation: 'København', global: false },
      { id: 'jobnet-search', name: 'Jobnet / STAR (Danish Public Employment)', defaultLocation: 'Danmark', global: false },
      { id: 'jobbank-search', name: 'Akademikernes Jobbank (Academic/Graduate)', defaultLocation: 'Danmark', global: false },
      { id: 'jobdanmark-search', name: 'Jobdanmark (Regional Denmark)', defaultLocation: 'Sjælland', global: false }
    ];
  },

  async searchJobs({ query = '', location = 'Remote', portal = 'freehire-search', limit = 25, remote = 'all' }) {
    const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 5), 100);
    console.log(`Executing search: portal=${portal}, query="${query}", location="${location}", limit=${cappedLimit}`);

    const skillCliPath = path.join(ROOT_DIR, '.agents/skills', portal, 'cli/src/cli.ts');
    
    // Check if Bun is available and skill file exists
    if (fs.existsSync(skillCliPath)) {
      try {
        const results = await this.runBunCli(portal, skillCliPath, { query, location, limit: cappedLimit, remote });
        if (results && results.length > 0) {
          return results;
        }
      } catch (cliErr) {
        console.warn(`Bun CLI execution for ${portal} returned:`, cliErr.message);
      }
    }

    // Direct HTTP API Fallbacks
    if (portal === 'freehire-search') {
      try {
        return await this.fetchFreehireDirect({ query, location, limit: cappedLimit });
      } catch (httpErr) {
        console.warn('Freehire direct fetch fallback failed:', httpErr.message);
      }
    }

    if (portal === 'linkedin-search') {
      try {
        const directLinkedin = await this.fetchLinkedinDirect({ query, location, limit: cappedLimit });
        if (directLinkedin && directLinkedin.length > 0) {
          return directLinkedin;
        }
      } catch (liErr) {
        console.warn('LinkedIn direct fetch fallback failed:', liErr.message);
      }
    }

    // Fallback Mock/Sample curated results if scrapers are offline/rate-limited
    return this.getSampleJobs(query, location, portal);
  },

  runBunCli(portal, scriptPath, { query, location, limit, remote }) {
    return new Promise((resolve, reject) => {
      const args = ['run', scriptPath, 'search'];

      if (portal === 'linkedin-search') {
        const searchLoc = (!location || location.toLowerCase() === 'remote') ? 'United States' : location;
        args.push('-l', searchLoc);
        if (query) args.push('-q', query);
        if (limit) args.push('-n', String(limit));
        if (location && location.toLowerCase() === 'remote') {
          args.push('--remote', 'remote');
        } else if (remote && remote !== 'all') {
          args.push('--remote', remote);
        }
        args.push('--format', 'json');
      } else if (portal === 'freehire-search') {
        if (query) args.push('-q', query);
        if (location && location.toLowerCase() !== 'remote' && location.toLowerCase() !== 'all') {
          args.push('--country', location);
        }
        if (limit) args.push('--limit', String(limit));
      } else {
        // Danish portals
        if (query) args.push('-q', query);
        if (location) args.push('-l', location);
        if (limit) args.push('-n', String(limit));
        args.push('--format', 'json');
      }

      console.log(`Spawning: bun ${args.join(' ')}`);

      const proc = spawn('bun', args, {
        cwd: ROOT_DIR,
        shell: true,
        timeout: 30000
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', data => { stdout += data.toString(); });
      proc.stderr.on('data', data => { stderr += data.toString(); });

      proc.on('close', code => {
        if (code !== 0 && !stdout) {
          return reject(new Error(`Process exited with code ${code}: ${stderr}`));
        }

        try {
          // Attempt to parse JSON from stdout
          const jsonMatch = stdout.match(/\[[\s\S]*\]/) || stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const jobsList = Array.isArray(parsed) ? parsed : (parsed.jobs || parsed.results || [parsed]);
            const normalized = jobsList.map((job, idx) => this.normalizeJob(job, portal, idx));
            return resolve(normalized);
          }
          resolve([]);
        } catch (parseErr) {
          console.warn('Failed to parse JSON stdout from Bun CLI:', parseErr.message);
          resolve([]);
        }
      });

      proc.on('error', err => {
        reject(err);
      });
    });
  },

  async fetchFreehireDirect({ query, location, limit = 25 }) {
    const baseUrl = process.env.FREEHIRE_API_URL || 'https://freehire.me';
    let url = `${baseUrl}/api/v1/jobs?limit=${limit}`;
    if (query) url += `&q=${encodeURIComponent(query)}`;
    if (location && location.toLowerCase() !== 'remote' && location.toLowerCase() !== 'all') {
      url += `&country=${encodeURIComponent(location)}`;
    }

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; AIJobSearch/1.3)' }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from FreeHire API`);
    }

    const data = await response.json();
    const jobs = data.jobs || data.data || data || [];
    return jobs.map((j, idx) => this.normalizeJob(j, 'freehire-search', idx));
  },

  async fetchLinkedinDirect({ query, location, limit = 25 }) {
    const searchLoc = (!location || location.toLowerCase() === 'remote') ? 'United States' : location;
    const isRemote = !location || location.toLowerCase() === 'remote';
    
    let url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query || 'Software')}&location=${encodeURIComponent(searchLoc)}&start=0`;
    if (isRemote) {
      url += `&f_WT=2`; // LinkedIn remote filter
    }

    console.log(`Fetching LinkedIn Guest API: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Requested-With': 'XMLHttpRequest'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`LinkedIn guest returned ${response.status}`);
    }

    const html = await response.text();
    const cardRegex = /<li[\s\S]*?<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>[\s\S]*?<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*class="[^"]*base-card__full-link[^"]*"[\s\S]*?<\/li>/gi;
    
    const results = [];
    let match;
    let index = 0;

    while ((match = cardRegex.exec(html)) !== null && results.length < limit) {
      const title = this.stripHtml(match[1]);
      const company = this.stripHtml(match[2]);
      const jobLocation = this.stripHtml(match[3]);
      const jobUrl = match[4].split('?')[0];

      if (title && company) {
        results.push({
          id: `li-${Date.now()}-${index}`,
          title,
          company,
          location: jobLocation || location || 'Remote',
          url: jobUrl,
          portal: 'linkedin-search',
          postedDate: 'Recently on LinkedIn',
          description: `Position: ${title} at ${company}. Located in ${jobLocation || 'Remote'}.\n\nApply and see full specifications at: ${jobUrl}`,
          skills: ['LinkedIn Opening', query || 'Engineering', 'Active Hiring'],
          seniority: title.toLowerCase().includes('senior') ? 'Senior Level' : title.toLowerCase().includes('lead') ? 'Lead' : 'Mid-Level',
          employmentType: 'Full-time',
          salary: 'Competitive'
        });
        index++;
      }
    }

    return results;
  },

  stripHtml(html) {
    return (html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  },

  normalizeJob(raw, portal, index) {
    return {
      id: raw.id || raw.slug || `job-${portal}-${Date.now()}-${index}`,
      title: raw.title || raw.job_title || 'Software Engineer',
      company: raw.company || raw.company_name || raw.employer || 'Technology Company',
      location: raw.location || raw.city || raw.region || 'Remote',
      url: raw.url || raw.link || raw.apply_url || (raw.slug ? `https://freehire.me/job/${raw.slug}` : 'https://linkedin.com'),
      portal: portal,
      postedDate: raw.posted_date || raw.date || raw.created_at || 'Recent',
      description: raw.description || raw.body || raw.summary || 'Full-stack software engineering position involving distributed systems, cloud applications, and modern frameworks.',
      skills: raw.skills || raw.tags || ['TypeScript', 'Node.js', 'React', 'Cloud'],
      seniority: raw.seniority || raw.level || 'Mid-Senior Level',
      employmentType: raw.employment_type || raw.type || 'Full-time',
      salary: raw.salary || raw.compensation || 'Competitive / Market Standard'
    };
  },

  getSampleJobs(query = 'Software Engineer', location = 'Remote', portal = 'freehire-search') {
    return [
      {
        id: `sample-1-${Date.now()}`,
        title: `Senior ${query || 'Full Stack'} Engineer`,
        company: 'Vortex Cloud Solutions',
        location: location || 'Remote / San Francisco, CA',
        url: 'https://example.com/careers/vortex-senior-engineer',
        portal: portal,
        postedDate: '2 days ago',
        description: `We are looking for an experienced Senior Engineer to help lead our distributed platform engineering team. You will architect high-scale backend services, build resilient APIs, and mentor junior engineers.\n\nRequirements:\n- 5+ years building scalable distributed web applications\n- Strong proficiency in Node.js/TypeScript or Go\n- Experience with PostgreSQL, Redis, and cloud infrastructure (AWS/GCP)\n- Passion for clean architecture and developer productivity.`,
        skills: ['TypeScript', 'Node.js', 'Go', 'PostgreSQL', 'Docker', 'AWS', 'Distributed Systems'],
        seniority: 'Senior Level',
        employmentType: 'Full-time',
        salary: '$160,000 - $195,000 / year'
      },
      {
        id: `sample-2-${Date.now()}`,
        title: `AI Platform & Backend Engineer`,
        company: 'Synthetix AI',
        location: location || 'Remote / New York, NY',
        url: 'https://example.com/careers/synthetix-ai-backend',
        portal: portal,
        postedDate: '1 day ago',
        description: `Join Synthetix AI to build next-generation enterprise agent orchestration systems. We work on cutting-edge LLM toolchains, streaming architectures, and low-latency API services.\n\nKey Responsibilities:\n- Design scalable backend microservices and streaming pipelines\n- Integrate LLM agents, vector databases, and real-time event streaming\n- Optimize system throughput and ensure 99.99% reliability.`,
        skills: ['Python', 'TypeScript', 'FastAPI', 'Node.js', 'Kubernetes', 'Redis', 'LLMs'],
        seniority: 'Mid-Senior Level',
        employmentType: 'Full-time',
        salary: '$150,000 - $185,000 / year'
      },
      {
        id: `sample-3-${Date.now()}`,
        title: `Lead Systems Software Engineer`,
        company: 'Apex Infrastructure Group',
        location: location || 'London, UK / Hybrid',
        url: 'https://example.com/careers/apex-lead-systems',
        portal: portal,
        postedDate: '3 days ago',
        description: `Apex Infrastructure is seeking a Lead Systems Engineer to oversee core platform reliability, API gateways, and data processing pipelines.\n\nIdeal Candidate:\n- Extensive background in microservices and cloud-native architecture\n- Strong experience in performance profiling and database scaling\n- Excellent written and verbal communication skills.`,
        skills: ['Go', 'TypeScript', 'Docker', 'Kubernetes', 'PostgreSQL', 'Kafka'],
        seniority: 'Lead / Principal',
        employmentType: 'Full-time',
        salary: '£95,000 - £120,000 / year'
      }
    ];
  }
};
