import app from './app.js';
import { claudeService } from './services/claudeService.js';
import { isAuthConfigured } from './middleware/auth.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {

  const authOk = isAuthConfigured();
  console.log('====================================================');
  console.log('AI Job Search');
  console.log(`Local:    http://localhost:${PORT}`);
  console.log(`Auth:     ${authOk ? 'password protection active' : 'NOT CONFIGURED - all logins refused'}`);
  console.log(`AI:       ${claudeService.isConfigured() ? claudeService.getProviderName() : 'no provider configured'}`);
  if (!authOk) {
    console.warn('');
    console.warn('  Set APP_PASSWORD in server/.env and restart. There is no default password.');
  }
  if (!claudeService.isConfigured()) {
    console.warn('  No AI provider reachable. Evaluation and drafting will report themselves unavailable.');
  }
  console.log('====================================================');
});
