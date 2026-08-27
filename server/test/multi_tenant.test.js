import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/db/database.js';

const PORT = 3299;
const BASE = `http://127.0.0.1:${PORT}`;

let server;

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }
  let body = options.body;
  if (body !== undefined && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${pathname}`, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers,
    body
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, body: json, text };
}

describe('Multi-Tenant Platform & RBAC Architecture', () => {
  before(async () => {
    process.env.PORT = String(PORT);
    process.env.SESSION_SECRET = 'test-multi-tenant-secret';
    process.env.AI_PROVIDER = 'none';

    const db = getDb();
    // Clean any previous test entries
    db.prepare("DELETE FROM users WHERE email LIKE '%@example.com'").run();
    db.prepare("DELETE FROM applications WHERE id LIKE '11111111-%' OR id LIKE '22222222-%'").run();
    db.prepare("DELETE FROM candidate_coach_assignments WHERE id = 'assign-1'").run();
    db.prepare("DELETE FROM collaboration_notes WHERE note LIKE '%Acme Corp%'").run();
    db.prepare("DELETE FROM collaboration_tasks WHERE title LIKE '%Stripe%'").run();

    const app = (await import('../src/app.js')).default;
    await new Promise(resolve => {
      server = app.listen(PORT, '127.0.0.1', resolve);
    });
  });

  after(() => {
    server?.close();
  });

  let candidateAToken = '';
  let candidateBToken = '';
  let coachToken = '';
  let adminToken = '';
  let candidateAId = '';
  let candidateBId = '';

  test('1. User Registration & Organization Setup', async () => {
    // Register Candidate A
    const resA = await request('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'alice.candidate@example.com',
        password: 'Password123!',
        fullName: 'Alice Candidate',
        role: 'candidate'
      }
    });

    assert.equal(resA.status, 201);
    assert.equal(resA.body.success, true);
    assert.ok(resA.body.token);
    assert.equal(resA.body.role, 'candidate');
    candidateAToken = resA.body.token;
    candidateAId = resA.body.userId;

    // Register Candidate B
    const resB = await request('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'bob.candidate@example.com',
        password: 'Password123!',
        fullName: 'Bob Candidate',
        role: 'candidate'
      }
    });

    assert.equal(resB.status, 201);
    assert.equal(resB.body.success, true);
    assert.ok(resB.body.token);
    candidateBToken = resB.body.token;
    candidateBId = resB.body.userId;

    // Register Coach
    const resCoach = await request('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'carol.coach@example.com',
        password: 'Password123!',
        fullName: 'Carol Coach',
        organizationName: 'Career Accelerators Inc',
        role: 'coach'
      }
    });

    assert.equal(resCoach.status, 201);
    assert.equal(resCoach.body.role, 'coach');
    coachToken = resCoach.body.token;

    // Register Platform Admin
    const resAdmin = await request('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'dan.admin@example.com',
        password: 'Password123!',
        fullName: 'Dan Admin',
        role: 'platform_admin'
      }
    });

    assert.equal(resAdmin.status, 201);
    assert.equal(resAdmin.body.role, 'platform_admin');
    adminToken = resAdmin.body.token;
  });

  test('2. Authentication & /api/auth/me Profile Context', async () => {
    const res = await request('/api/auth/me', {
      token: candidateAToken
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.email, 'alice.candidate@example.com');
    assert.equal(res.body.role, 'candidate');
    assert.ok(res.body.organizationId);
  });

  test('3. Profile Completeness Calculation on Save', async () => {
    const profilePayload = {
      identity: {
        name: 'Alice Candidate',
        email: 'alice.candidate@example.com',
        phone: '+1 555-0199',
        title: 'Senior Software Engineer',
        summary: 'Experienced full-stack engineer with expertise in distributed systems and cloud architecture.'
      },
      experience: [
        {
          title: 'Staff Engineer',
          company: 'Acme Corp',
          startDate: '2022',
          highlights: ['Architected low-latency microservices handling 10M daily requests.']
        }
      ],
      skills: {
        primary: ['TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'Python'],
        tools: ['Git', 'Kubernetes']
      },
      education: [
        { degree: 'B.S. in Computer Science', institution: 'University of Tech' }
      ]
    };

    const res = await request('/api/profile', {
      method: 'POST',
      token: candidateAToken,
      body: profilePayload
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.profile.completeness);
    assert.ok(res.body.profile.completeness.score >= 70, `Expected score >= 70, got ${res.body.profile.completeness.score}`);
    assert.ok(res.body.profile.completeness.atsScore >= 70);
  });

  test('4. Candidate Tenant Isolation: Applications', async () => {
    // Alice creates an application
    const appA = await request('/api/tracker', {
      method: 'POST',
      token: candidateAToken,
      body: {
        id: '11111111-1111-1111-1111-111111111111',
        jobTitle: 'Staff Backend Engineer',
        company: 'Stripe',
        location: 'Remote',
        status: 'Drafted'
      }
    });

    assert.equal(appA.status, 200);
    assert.equal(appA.body.application.jobTitle, 'Staff Backend Engineer');

    // Bob creates an application
    const appB = await request('/api/tracker', {
      method: 'POST',
      token: candidateBToken,
      body: {
        id: '22222222-2222-2222-2222-222222222222',
        jobTitle: 'Data Engineer',
        company: 'Snowflake',
        location: 'San Francisco, CA',
        status: 'Applied'
      }
    });

    assert.equal(appB.status, 200);

    // Alice queries tracker — should ONLY see her own application
    const aliceApps = await request('/api/tracker', {
      token: candidateAToken
    });

    assert.equal(aliceApps.status, 200);
    const aliceIds = aliceApps.body.applications.map(a => a.id);
    assert.ok(aliceIds.includes('11111111-1111-1111-1111-111111111111'));
    assert.ok(!aliceIds.includes('22222222-2222-2222-2222-222222222222'));
  });

  test('5. RBAC Guards: Candidate cannot access Coach or Admin routes', async () => {
    const coachRes = await request('/api/coach/candidates', {
      token: candidateAToken
    });

    assert.equal(coachRes.status, 403);

    const adminRes = await request('/api/admin/overview', {
      token: candidateAToken
    });

    assert.equal(adminRes.status, 403);
  });

  test('6. Coach Collaboration Workflows (Notes & Tasks)', async () => {
    // Admin assigns Coach to Candidate A
    const db = getDb();
    const coachUser = db.prepare('SELECT id, (SELECT organization_id FROM memberships WHERE user_id = users.id) as org_id FROM users WHERE email = ?').get('carol.coach@example.com');

    db.prepare(`
      INSERT INTO candidate_coach_assignments (id, organization_id, candidate_id, coach_user_id, status, created_at)
      VALUES ('assign-1', ?, ?, ?, 'active', ?)
    `).run(coachUser.org_id, candidateAId, coachUser.id, new Date().toISOString());

    // Coach views assigned candidates
    const candidatesRes = await request('/api/coach/candidates', {
      token: coachToken
    });

    assert.equal(candidatesRes.status, 200);
    assert.ok(Array.isArray(candidatesRes.body.candidates));

    // Coach adds collaboration note
    const noteRes = await request('/api/coach/notes', {
      method: 'POST',
      token: coachToken,
      body: {
        candidateId: candidateAId,
        note: 'Great achievements in Acme Corp bullet. Let us quantify revenue impact.',
        visibility: 'shared'
      }
    });

    assert.equal(noteRes.status, 201);
    assert.ok(noteRes.body.note.id);

    // Coach assigns a task
    const taskRes = await request('/api/coach/tasks', {
      method: 'POST',
      token: coachToken,
      body: {
        candidateId: candidateAId,
        title: 'Add metrics to Stripe application CV draft',
        description: 'Mention the 10M req/sec metric in bullet 1.'
      }
    });

    assert.equal(taskRes.status, 201);
    assert.ok(taskRes.body.task.id);
  });

  test('7. Admin Console Metrics & Audit Log Queries', async () => {
    // Admin gets overview
    const overviewRes = await request('/api/admin/overview', {
      token: adminToken
    });

    assert.equal(overviewRes.status, 200);
    assert.ok(overviewRes.body.metrics.totalOrganizations >= 3);
    assert.ok(overviewRes.body.metrics.totalUsers >= 4);

    // Admin queries audit logs
    const auditRes = await request('/api/admin/audit-logs', {
      token: adminToken
    });

    assert.equal(auditRes.status, 200);
    assert.ok(Array.isArray(auditRes.body.logs));
    assert.ok(auditRes.body.logs.length > 0);

    const actions = auditRes.body.logs.map(l => l.action);
    assert.ok(actions.includes('auth.register'));
    assert.ok(actions.includes('profile.update'));
  });
});
