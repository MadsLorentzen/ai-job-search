import app from './app.js';
import { claudeService } from './services/claudeService.js';
import { isAuthConfigured, isUsingPlaintextPassword } from './middleware/auth.js';
import { logger } from './config/logger.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  const authOk = isAuthConfigured();

  logger.info({
    url: `http://localhost:${PORT}`,
    auth: authOk ? 'configured' : 'NOT CONFIGURED',
    ai: claudeService.isConfigured() ? claudeService.getProviderName() : 'no provider'
  }, 'OppertuneX is running');

  if (!authOk) {
    logger.warn('No password is set, so every login is refused. Run `npm run set-password` in server/ and restart.');
  } else if (isUsingPlaintextPassword()) {
    logger.warn('APP_PASSWORD is stored in plaintext. Run `npm run set-password` to replace it with a scrypt hash.');
  }

  if (!claudeService.isConfigured()) {
    logger.warn('No AI provider reachable. Evaluation and drafting will report themselves unavailable.');
  }
});
