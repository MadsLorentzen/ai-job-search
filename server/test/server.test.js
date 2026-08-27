/**
 * Regression tests for the security and correctness defects fixed in this
 * change. Each case pins a specific bug so it cannot silently return.
 *
 * Run with:  npm test   (node --test, no external framework)
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_PASSWORD = 'test-password-for-suite-only';
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.APP_PASSWORD = TEST_PASSWORD;
process.env.PORT = String(PORT);
process.env.SESSION_SECRET = 'test-session-secret';
// Keep the suite offline and deterministic, even on a machine with the
// Claude CLI installed and logged in.
process.env.AI_PROVIDER = 'none';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.KIMI_API_KEY;
delete process.env.QWEN_API_KEY;

let server;
let token;

async function api(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${pathname}`, { ...options, headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { res, json, text };
}

before(async () => {
  const app = (await import('../src/app.js')).default;
  await new Promise(resolve => {
    server = app.listen(PORT, '127.0.0.1', resolve);
  });

  const { json } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: TEST_PASSWORD })
  });
  token = json.token;
});

after(() => {
  server?.close();
});

// ---------------------------------------------------------------------------

describe('authentication', () => {
  test('C1: the removed hardcoded fallback password is rejected', async () => {
    const { res, json } = await api('/api/auth/login', {
      method: 'POST',
      headers: { Authorization: '' },
      body: JSON.stringify({ password: 'oppertuneX!@#$999' })
    });
    assert.equal(res.status, 401);
    assert.equal(json.success, false);
  });

  test('C2: a failed login does not disclose any password', async () => {
    const { text } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'definitely-wrong' })
    });
    assert.doesNotMatch(text, /oppertune/i);
    assert.doesNotMatch(text, /fallback/i);
    assert.doesNotMatch(text, new RegExp(TEST_PASSWORD));
  });

  test('C6: the issued token is not the password', async () => {
    assert.ok(token, 'login should return a token');
    assert.notEqual(token, TEST_PASSWORD);
    assert.ok(token.split('.').length === 3, 'token should be a signed triple');
  });

  test('C6: a token in the query string is not accepted', async () => {
    const res = await fetch(`${BASE}/api/profile?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 401);
  });

  test('a forged token is rejected', async () => {
    const res = await fetch(`${BASE}/api/profile`, {
      headers: { Authorization: 'Bearer forged.9999999999999.deadbeef' }
    });
    assert.equal(res.status, 401);
  });

  test('protected routes require a token', async () => {
    const res = await fetch(`${BASE}/api/tracker`);
    assert.equal(res.status, 401);
  });

  test('a valid token grants access', async () => {
    const { res } = await api('/api/profile');
    assert.equal(res.status, 200);
  });
});

describe('path traversal and injection', () => {
  test('C3: a traversal appId is rejected instead of writing outside the build dir', async () => {
    const marker = path.join(os.tmpdir(), `jobsearch-traversal-${Date.now()}`);
    const { res, json } = await api('/api/apply/compile', {
      method: 'POST',
      body: JSON.stringify({
        type: 'cv',
        latexContent: 'MARKER',
        appId: `../../../../../..${marker}`
      })
    });

    assert.equal(res.status, 400);
    // Rejected by the request schema now, before it can reach the path layer.
    assert.match(json.error, /uuid/i);
    assert.equal(fs.existsSync(marker), false, 'nothing should be written outside the build directory');
  });

  test('C3: an unknown document type is rejected', async () => {
    const { res } = await api('/api/apply/compile', {
      method: 'POST',
      body: JSON.stringify({ type: '../../etc', latexContent: 'x', appId: null })
    });
    assert.equal(res.status, 400);
  });

  test('C4: the tracker refuses to store a client-supplied PDF path', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    await api('/api/tracker', {
      method: 'POST',
      body: JSON.stringify({
        id,
        jobTitle: 'Test',
        company: 'Test',
        cvPdfPath: '/etc/passwd'
      })
    });

    const { json } = await api('/api/tracker');
    const stored = json.applications.find(a => a.id === id);
    assert.ok(stored, 'record should be created');
    assert.equal(stored.cvPdfPath, undefined, 'client-supplied path must be stripped');
  });

  test('C4: downloading cannot read an arbitrary file', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const { res, text } = await api(`/api/apply/download/${id}/cv-pdf`);
    assert.equal(res.status, 404);
    assert.doesNotMatch(text, /root:x:0:0/);
  });

  test('a non-UUID appId is refused by the download route', async () => {
    const { res } = await api('/api/apply/download/..%2F..%2Fetc%2Fpasswd/cv-pdf');
    assert.equal(res.status, 400);
  });
});

describe('honest output', () => {
  test('H1: ATS verification is not reported as passed when nothing checked it', async () => {
    const { json } = await api('/api/apply/compile', {
      method: 'POST',
      body: JSON.stringify({ type: 'cv', latexContent: '\\section{Test}\nHello world.' })
    });

    const ats = json.atsVerification;
    assert.ok(ats, 'compile should report an ATS result');
    if (!ats.verified) {
      assert.notEqual(ats.pass, true, 'an unverified document must not report pass:true');
      assert.ok(ats.reason, 'an unverified result should explain why');
    }
    assert.notEqual(ats.extractedCharacters, 1250, 'the hardcoded character count must be gone');
  });

  test('H3: only portals whose CLI is present are advertised', async () => {
    const { json } = await api('/api/scrape/portals');
    const ids = json.portals.map(p => p.id);

    // Every advertised portal must be backed by a real CLI (or be one of the
    // two the server fetches directly over HTTP).
    const direct = ['freehire-search', 'linkedin-search'];
    for (const id of ids) {
      if (direct.includes(id)) continue;
      assert.ok(
        fs.existsSync(path.join(process.cwd(), '../.agents/skills', id, 'cli/src/cli.ts')),
        `${id} is advertised but has no CLI`
      );
    }
  });

  test('H3: an unknown portal is a 400, not fabricated sample jobs', async () => {
    const { res, json } = await api('/api/scrape/search?portal=not-a-real-portal');
    assert.equal(res.status, 400);
    assert.match(json.error, /unavailable portal/i);
  });

  test('H3: an unreachable portal returns nothing rather than invented postings', async () => {
    // bun is not installed in CI, so the Danish CLI portals cannot run. The old
    // code answered that with three hardcoded jobs at example.com URLs.
    const { res, json } = await api('/api/scrape/search?portal=jobdanmark-search&query=test');
    assert.equal(res.status, 200);
    assert.equal(json.isSample, false);
    for (const job of json.jobs) {
      assert.doesNotMatch(job.url || '', /example\.com/);
      assert.notEqual(job.company, 'Vortex Cloud Solutions');
    }
  });

  test('H2: with no provider configured, evaluation reports itself unavailable', async () => {
    const { json } = await api('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        job: { title: 'Engineer', company: 'Test', description: 'x'.repeat(80) }
      })
    });

    assert.equal(json.evaluation.source, 'unavailable');
    assert.equal(json.evaluation.overallScore, null, 'must not invent a score');
    assert.ok(json.evaluation.message);
  });
});

describe('correctness', () => {
  test('M1: the compile response carries real base64, not comma-joined bytes', async () => {
    const { json } = await api('/api/apply/compile', {
      method: 'POST',
      body: JSON.stringify({ type: 'cv', latexContent: '\\section{Test}\nHello.' })
    });

    assert.ok(json.pdfBase64, 'compile should return a PDF');
    assert.doesNotMatch(json.pdfBase64.slice(0, 40), /,/, 'must not be comma-joined byte values');
    assert.match(json.pdfBase64, /^[A-Za-z0-9+/=]+$/);

    const decoded = Buffer.from(json.pdfBase64, 'base64');
    assert.equal(decoded.subarray(0, 4).toString('latin1'), '%PDF');
  });

  test('M2: non-Latin-1 characters do not crash document generation', async () => {
    const { res, json } = await api('/api/apply/compile', {
      method: 'POST',
      body: JSON.stringify({
        type: 'cv',
        latexContent: '\\section{Doświadczenie}\nMichał Kowalski, Łódź. Ελλάδα. 日本語.'
      })
    });

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.pdfBase64);
  });

  test('M5: an unknown API route returns JSON 404, not the HTML shell', async () => {
    const { res, json, text } = await api('/api/no-such-route');
    assert.equal(res.status, 404);
    assert.ok(json, `expected JSON, got: ${text.slice(0, 80)}`);
    assert.equal(json.success, false);
  });

  test('tracker rejects an unknown status', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const { res } = await api(`/api/tracker/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'NotARealStatus' })
    });
    assert.equal(res.status, 400);
  });

  test('M6: concurrent writes do not lose records', async () => {
    const ids = Array.from({ length: 25 }, (_, i) =>
      `aaaaaaaa-bbbb-cccc-dddd-${String(i).padStart(12, '0')}`
    );

    await Promise.all(ids.map(id => api('/api/tracker', {
      method: 'POST',
      body: JSON.stringify({ id, jobTitle: `Role ${id}`, company: 'Concurrent' })
    })));

    const { json } = await api('/api/tracker');
    const stored = new Set(json.applications.map(a => a.id));
    const missing = ids.filter(id => !stored.has(id));
    assert.equal(missing.length, 0, `lost ${missing.length} of ${ids.length} concurrent writes`);
  });
});

describe('input validation', () => {
  test('profile rejects a non-object body', async () => {
    const { res } = await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify(['not', 'an', 'object'])
    });
    assert.equal(res.status, 400);
  });

  test('evaluate requires a description', async () => {
    const { res } = await api('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify({ job: { title: 'Engineer' } })
    });
    assert.equal(res.status, 400);
  });
});

describe('storage (SQLite)', () => {
  test('an application survives a read-back with every field intact', async () => {
    const id = 'aabbccdd-1122-3344-5566-778899aabbcc';
    await api('/api/tracker', {
      method: 'POST',
      body: JSON.stringify({
        id, jobTitle: 'Platform Engineer', company: 'Northwind',
        status: 'Applied', fitScore: 74, notes: 'Referred by a colleague.'
      })
    });

    const { json } = await api('/api/tracker');
    const stored = json.applications.find(a => a.id === id);
    assert.equal(stored.jobTitle, 'Platform Engineer');
    assert.equal(stored.fitScore, 74);
    assert.equal(stored.notes, 'Referred by a colleague.');
    assert.equal(stored.status, 'Applied');
  });

  test('a partial update does not blank the fields it omits', async () => {
    const id = 'aabbccdd-1122-3344-5566-778899aabbcc';
    await api(`/api/tracker/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'Updated note.' })
    });

    const { json } = await api('/api/tracker');
    const stored = json.applications.find(a => a.id === id);
    assert.equal(stored.notes, 'Updated note.');
    assert.equal(stored.jobTitle, 'Platform Engineer', 'omitted field must be preserved');
    assert.equal(stored.fitScore, 74, 'omitted field must be preserved');
  });

  test('filtering by search term works', async () => {
    const { json } = await api('/api/tracker?search=Northwind');
    assert.ok(json.applications.length >= 1);
    assert.ok(json.applications.every(a => /northwind/i.test(a.company + a.jobTitle + a.notes)));
  });

  test('a past follow-up date is reported as due', async () => {
    const id = 'aabbccdd-1122-3344-5566-778899aabbcc';
    await api(`/api/tracker/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ followUpAt: '2020-01-01T09:00:00.000Z' })
    });

    const { json } = await api('/api/tracker');
    assert.ok(json.dueFollowUps.includes(id));
  });

  test('document versions accumulate rather than overwrite', async () => {
    const { json: first } = await api('/api/apply/compile', {
      method: 'POST',
      body: JSON.stringify({ type: 'cv', latexContent: '\\section{One}' })
    });
    const appId = first.appId;

    await api('/api/tracker', {
      method: 'POST',
      body: JSON.stringify({ id: appId, jobTitle: 'Versioned' })
    });

    for (const body of ['\\section{Two}', '\\section{Three}']) {
      await api('/api/apply/compile', {
        method: 'POST',
        body: JSON.stringify({ type: 'cv', latexContent: body, appId })
      });
    }

    const { json } = await api(`/api/apply/versions/${appId}/cv`);
    assert.ok(json.versions.length >= 2, `expected multiple versions, got ${json.versions.length}`);
  });
});

describe('validation', () => {
  test('unknown keys are stripped rather than persisted', async () => {
    const id = 'ffffffff-1111-2222-3333-444444444444';
    await api('/api/tracker', {
      method: 'POST',
      body: JSON.stringify({ id, jobTitle: 'X', coverPdfPath: '/etc/shadow', evil: true })
    });

    const { json } = await api('/api/tracker');
    const stored = json.applications.find(a => a.id === id);
    assert.equal(stored.coverPdfPath, undefined);
    assert.equal(stored.evil, undefined);
  });

  test('an out-of-range score is rejected', async () => {
    const { res } = await api('/api/tracker', {
      method: 'POST',
      body: JSON.stringify({ id: 'ffffffff-1111-2222-3333-444444444444', fitScore: 500 })
    });
    assert.equal(res.status, 400);
  });

  test('validation errors name the offending field', async () => {
    const { res, json } = await api('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify({ job: { title: 'Engineer', description: 'too short' } })
    });
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(json.details));
    assert.match(json.details.join(' '), /description/);
  });
});

describe('seen-job memory', () => {
  test('an unknown job id cannot be marked', async () => {
    const { res } = await api('/api/scrape/jobs/not-a-real-job/state', {
      method: 'PATCH',
      body: JSON.stringify({ state: 'dismissed' })
    });
    assert.equal(res.status, 404);
  });

  test('an invalid state is rejected', async () => {
    const { res } = await api('/api/scrape/jobs/anything/state', {
      method: 'PATCH',
      body: JSON.stringify({ state: 'banana' })
    });
    assert.equal(res.status, 400);
  });
});

describe('streamed generation', () => {
  test('emits stage events and a completion frame', async () => {
    const res = await fetch(`${BASE}/api/apply/generate/stream`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job: {
          title: 'Streaming Engineer',
          company: 'Acme',
          description: 'Backend role requiring Go and Postgres experience across distributed services.'
        }
      })
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);

    const body = await res.text();
    assert.match(body, /event: stage/);
    assert.match(body, /"stage":"drafter"/);
    assert.match(body, /event: complete/);
  });
});

describe('portal detail', () => {
  test('an unknown portal is rejected', async () => {
    const { res } = await api('/api/scrape/detail?portal=nope&url=https%3A%2F%2Fexample.com%2Fjob');
    assert.equal(res.status, 400);
  });

  test('a missing url is rejected', async () => {
    const { res } = await api('/api/scrape/detail?portal=jobindex-search');
    assert.equal(res.status, 400);
  });
});

describe('password hashing', () => {
  test('a scrypt hash verifies its own password and rejects others', async () => {
    const { hashPassword } = await import('../src/middleware/auth.js');
    const hash = await hashPassword('correct horse battery staple');

    assert.match(hash, /^scrypt\$/);
    assert.ok(!hash.includes('correct horse'), 'the password must not appear in the hash');

    const original = process.env.APP_PASSWORD_HASH;
    const originalPlain = process.env.APP_PASSWORD;
    process.env.APP_PASSWORD_HASH = hash;
    delete process.env.APP_PASSWORD;

    try {
      const { verifyPassword } = await import('../src/middleware/auth.js');
      assert.equal(await verifyPassword('correct horse battery staple'), true);
      assert.equal(await verifyPassword('wrong password'), false);
    } finally {
      if (original === undefined) delete process.env.APP_PASSWORD_HASH;
      else process.env.APP_PASSWORD_HASH = original;
      process.env.APP_PASSWORD = originalPlain;
    }
  });
});
