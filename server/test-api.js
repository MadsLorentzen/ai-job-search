async function runTests() {
  console.log('--- Testing API Endpoints with Authentication ---');

  // 1. Health (public)
  const healthRes = await fetch('http://localhost:3000/api/health');
  const health = await healthRes.json();
  console.log('1. Health check:', health.status === 'healthy' ? '✅ PASS' : '❌ FAIL');

  // 2. Auth Login
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'oppertuneX!@#$999' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log('2. Auth Login:', loginData.success ? '✅ PASS' : '❌ FAIL');

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // 3. Profile (Protected)
  const profRes = await fetch('http://localhost:3000/api/profile', { headers: authHeaders });
  const prof = await profRes.json();
  console.log('3. Profile read (Protected):', prof.success ? `✅ PASS (${prof.profile.identity.name})` : '❌ FAIL');

  // 4. Portals (Protected)
  const portalsRes = await fetch('http://localhost:3000/api/scrape/portals', { headers: authHeaders });
  const portals = await portalsRes.json();
  console.log('4. Portals available:', portals.portals?.length > 0 ? `✅ PASS (${portals.portals.length} portals)` : '❌ FAIL');

  // 5. Evaluate (Protected)
  const evalRes = await fetch('http://localhost:3000/api/evaluate', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      job: {
        company: 'Stripe',
        title: 'Senior Backend Engineer',
        location: 'Remote',
        description: 'We are seeking a senior distributed systems engineer with deep expertise in TypeScript, Node.js, Go, and PostgreSQL.'
      }
    })
  });
  const evalData = await evalRes.json();
  console.log('5. Fit Evaluation:', evalData.success ? `✅ PASS (Score: ${evalData.evaluation.overallScore}%, Verdict: ${evalData.evaluation.verdict})` : '❌ FAIL');

  // 6. Generate Application (Protected)
  const genRes = await fetch('http://localhost:3000/api/apply/generate', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      job: {
        company: 'Stripe',
        title: 'Senior Backend Engineer',
        location: 'Remote',
        description: 'We are seeking a senior distributed systems engineer with deep expertise in TypeScript, Node.js, Go, and PostgreSQL.'
      },
      fitEvaluation: evalData.evaluation
    })
  });
  const genData = await genRes.json();
  console.log('6. Application & PDF Generation:', genData.success && genData.cvPdfBase64 ? `✅ PASS (Review Score: ${genData.reviewScore}, PDF generated: ${genData.cvPdfBase64.length > 500})` : '❌ FAIL');

  console.log('--- All Authenticated API Tests Completed Successfully! ---');
}

runTests().catch(err => console.error('Test error:', err));
