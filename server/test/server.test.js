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
// Keep the suite offline and deterministic.
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
    assert.match(json.error, /Invalid application id/i);
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

  test('H3: portals with no CLI behind them are not advertised', async () => {
    const { json } = await api('/api/scrape/portals');
    const ids = json.portals.map(p => p.id);
    assert.ok(!ids.includes('jobindex-search'));
    assert.ok(!ids.includes('jobnet-search'));
  });

  test('H3: an unavailable portal is a 400, not fabricated sample jobs', async () => {
    const { res, json } = await api('/api/scrape/search?portal=jobindex-search');
    assert.equal(res.status, 400);
    assert.match(json.error, /unavailable portal/i);
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
