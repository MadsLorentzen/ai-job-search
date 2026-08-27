/**
 * Parser tests against saved fixtures.
 *
 * The scrapers parse third-party HTML and JSON with regexes, so they will
 * break the next time a portal adjusts a class name, and the failure looks
 * exactly like "no jobs found today". These pin the parsing behaviour so a
 * break shows up as a red test rather than as silence.
 *
 * The portal CLIs in .agents/skills already use this pattern (see their
 * detail-parsing and search-normalization tests); this brings the server's own
 * two direct fetchers under the same discipline.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_PROVIDER = 'none';

const { scraperService } = await import('../src/services/scraperService.js');

/** Two cards in the shape LinkedIn's guest endpoint returns. */
const LINKEDIN_FIXTURE = `
<ul class="jobs-search__results-list">
  <li>
    <div class="base-card">
      <h3 class="base-search-card__title">
        Senior Backend Engineer
      </h3>
      <h4 class="base-search-card__subtitle">
        <a class="hidden-nested-link">Northwind Systems</a>
      </h4>
      <span class="job-search-card__location">Copenhagen, Denmark</span>
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/senior-backend-engineer-4300011451?refId=abc&amp;trk=guest">
      </a>
    </div>
  </li>
  <li>
    <div class="base-card">
      <h3 class="base-search-card__title">
        Platform Engineer
      </h3>
      <h4 class="base-search-card__subtitle">
        <a class="hidden-nested-link">Contoso A/S</a>
      </h4>
      <span class="job-search-card__location">Remote</span>
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/platform-engineer-4300099999?refId=def">
      </a>
    </div>
  </li>
</ul>`;

describe('stripHtml', () => {
  test('removes tags and collapses whitespace', () => {
    assert.equal(
      scraperService.stripHtml('\n  <a class="x">Northwind   Systems</a>\n '),
      'Northwind Systems'
    );
  });

  test('tolerates empty input', () => {
    assert.equal(scraperService.stripHtml(''), '');
    assert.equal(scraperService.stripHtml(null), '');
  });
});

describe('normalizeJob', () => {
  test('maps a FreeHire payload onto the app shape', () => {
    const job = scraperService.normalizeJob({
      title: 'Go Developer',
      company_name: 'Zensar',
      city: 'Aarhus',
      slug: 'golang-zensar-2bxu6dxm',
      description: 'Build services in Go.',
      tags: ['Go', 'Kubernetes'],
      salary: '600000 DKK'
    }, 'freehire-search');

    assert.equal(job.title, 'Go Developer');
    assert.equal(job.company, 'Zensar');
    assert.equal(job.location, 'Aarhus');
    assert.equal(job.url, 'https://freehire.me/job/golang-zensar-2bxu6dxm');
    assert.deepEqual(job.skills, ['Go', 'Kubernetes']);
  });

  test('leaves missing fields empty instead of inventing plausible values', () => {
    const job = scraperService.normalizeJob({ title: 'Engineer' }, 'freehire-search');

    // Filling these with defaults previously made fabricated data
    // indistinguishable from real data downstream.
    assert.equal(job.company, '');
    assert.equal(job.salary, '');
    assert.equal(job.seniority, '');
    assert.deepEqual(job.skills, []);
    assert.equal(job.description, '');
  });

  test('derives a stable id from content', () => {
    const payload = { title: 'Engineer', company: 'Acme', url: 'https://example.com/job/1' };
    const first = scraperService.normalizeJob(payload, 'freehire-search');
    const second = scraperService.normalizeJob(payload, 'freehire-search');

    // Ids used to be built from Date.now(), so the same posting got a new id
    // on every search and could never be deduplicated across runs.
    assert.equal(first.id, second.id);
    assert.doesNotMatch(first.id, /\d{13}/, 'id must not embed a timestamp');
  });

  test('different postings get different ids', () => {
    const a = scraperService.normalizeJob({ title: 'A', url: 'https://example.com/1' }, 'p');
    const b = scraperService.normalizeJob({ title: 'B', url: 'https://example.com/2' }, 'p');
    assert.notEqual(a.id, b.id);
  });
});

describe('dedupe', () => {
  test('drops repeats while preserving order', () => {
    const jobs = [
      { id: 'a', title: 'First' },
      { id: 'b', title: 'Second' },
      { id: 'a', title: 'Duplicate' }
    ];
    const result = scraperService.dedupe(jobs);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map(j => j.title), ['First', 'Second']);
  });
});

describe('LinkedIn card parsing', () => {
  test('extracts every card from the fixture', () => {
    const cards = scraperService.parseLinkedinCards(LINKEDIN_FIXTURE);
    assert.equal(cards.length, 2, 'both cards should parse');
  });

  test('reads the fields off the first card', () => {
    const [first] = scraperService.parseLinkedinCards(LINKEDIN_FIXTURE);
    assert.equal(first.title, 'Senior Backend Engineer');
    assert.equal(first.company, 'Northwind Systems');
    assert.equal(first.location, 'Copenhagen, Denmark');
  });

  test('strips tracking parameters from the URL', () => {
    const [first] = scraperService.parseLinkedinCards(LINKEDIN_FIXTURE);
    assert.equal(first.url, 'https://www.linkedin.com/jobs/view/senior-backend-engineer-4300011451');
    assert.doesNotMatch(first.url, /refId|trk/);
  });

  test('parses regardless of attribute order on the link', () => {
    // The previous single-regex parser required href to precede class, so a
    // cosmetic markup reshuffle silently produced zero results.
    const hrefFirst = LINKEDIN_FIXTURE.replace(
      /<a class="base-card__full-link" href="([^"]+)">/g,
      '<a href="$1" class="base-card__full-link">'
    );
    assert.equal(scraperService.parseLinkedinCards(hrefFirst).length, 2);
  });

  test('a card missing its link is skipped rather than half-parsed', () => {
    const noLink = `<li>
      <h3 class="base-search-card__title">Orphan Role</h3>
      <h4 class="base-search-card__subtitle">Nobody</h4>
      <span class="job-search-card__location">Nowhere</span>
    </li>`;
    assert.equal(scraperService.parseLinkedinCards(noLink).length, 0);
  });

  test('markup without the expected classes yields nothing, not garbage', () => {
    assert.equal(scraperService.parseLinkedinCards('<ul><li><div>Unrelated</div></li></ul>').length, 0);
    assert.equal(scraperService.parseLinkedinCards('').length, 0);
  });
});

describe('detail output parsing', () => {
  test('reads a description out of a portal payload', () => {
    const parsed = scraperService.parseDetailOutput(JSON.stringify({
      job: {
        title: 'Backend Engineer',
        company: 'Northwind',
        location: 'Copenhagen',
        description: 'You will build and operate our payment services.',
        deadline: '2026-09-30'
      }
    }));

    assert.ok(parsed);
    assert.equal(parsed.title, 'Backend Engineer');
    assert.match(parsed.description, /payment services/);
    assert.equal(parsed.deadline, '2026-09-30');
  });

  test('accepts a flat payload with no job wrapper', () => {
    const parsed = scraperService.parseDetailOutput(JSON.stringify({
      title: 'Data Engineer',
      body: 'Own our data pipelines end to end.'
    }));
    assert.ok(parsed);
    assert.match(parsed.description, /data pipelines/);
  });

  test('ignores log noise printed before the JSON', () => {
    const parsed = scraperService.parseDetailOutput(
      'Fetching detail page...\nresolved 3 modules\n' +
      JSON.stringify({ title: 'X', description: 'A real description of the role.' })
    );
    assert.ok(parsed);
    assert.equal(parsed.title, 'X');
  });

  test('a payload with no description is rejected rather than returned empty', () => {
    assert.equal(scraperService.parseDetailOutput(JSON.stringify({ title: 'X' })), null);
    assert.equal(scraperService.parseDetailOutput('not json at all'), null);
    assert.equal(scraperService.parseDetailOutput(''), null);
  });
});

describe('portal availability', () => {
  test('every advertised portal is backed by a CLI or a direct fetcher', () => {
    const direct = ['freehire-search', 'linkedin-search'];
    for (const portal of scraperService.getAvailablePortals()) {
      if (direct.includes(portal.id)) continue;
      assert.ok(
        scraperService.isPortalAvailable(portal.id),
        `${portal.id} is advertised but not available`
      );
    }
  });

  test('an unknown portal is not available', () => {
    assert.equal(scraperService.isPortalAvailable('not-a-real-portal'), false);
  });
});
