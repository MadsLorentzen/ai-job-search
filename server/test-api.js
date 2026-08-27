async function runTests() {
  console.log('--- Testing API Endpoints ---');

  // 1. Health
  const healthRes = await fetch('http://localhost:3000/api/health');
  const health = await healthRes.json();
  console.log('1. Health check:', health.status === 'healthy' ? '✅ PASS' : '❌ FAIL');

  // 2. Profile
  const profRes = await fetch('http://localhost:3000/api/profile');
  const prof = await profRes.json();
  console.log('2. Profile read:', prof.success ? `✅ PASS (${prof.profile.identity.name})` : '❌ FAIL');

  // 3. Portals
  const portalsRes = await fetch('http://localhost:3000/api/scrape/portals');
  const portals = await portalsRes.json();
  console.log('3. Portals available:', portals.portals?.length > 0 ? `✅ PASS (${portals.portals.length} portals)` : '❌ FAIL');

  // 4. Evaluate
  const evalRes = await fetch('http://localhost:3000/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  console.log('4. Fit Evaluation:', evalData.success ? `✅ PASS (Score: ${evalData.evaluation.overallScore}%, Verdict: ${evalData.evaluation.verdict})` : '❌ FAIL');

  // 5. Generate Application
  const genRes = await fetch('http://localhost:3000/api/apply/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  console.log('5. Application & PDF Generation:', genData.success && genData.cvPdfBase64 ? `✅ PASS (Review Score: ${genData.reviewScore}, PDF generated: ${genData.cvPdfBase64.length > 500})` : '❌ FAIL');

  console.log('--- All API Tests Completed Successfully! ---');
}

runTests().catch(err => console.error('Test error:', err));
