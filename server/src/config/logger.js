import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

/**
 * Structured logger.
 *
 * Everything used to go to console.log at a fixed verbosity, including full
 * search URLs and login outcomes, with nothing guaranteeing a secret never
 * reached a log line. The redaction list below is the guarantee.
 */
export const logger = pino({
  level,
  redact: {
    paths: [
      'password',
      'token',
      'apiKey',
      'req.headers.authorization',
      'req.headers["x-access-token"]',
      'req.body.password',
      '*.password',
      '*.token',
      '*.apiKey',
      '*.ANTHROPIC_API_KEY',
      '*.OPENAI_API_KEY'
    ],
    censor: '[redacted]'
  },
  transport: isProduction ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }
  }
});

/** Child logger for a subsystem, so log lines say where they came from. */
export function loggerFor(component) {
  return logger.child({ component });
}
