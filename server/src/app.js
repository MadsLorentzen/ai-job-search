import express from 'express';
import cors from 'cors';
import path from 'path';

import { loadEnv, SERVER_DIR } from './config/env.js';

loadEnv();

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import scrapeRoutes from './routes/scrape.js';
import evaluateRoutes from './routes/evaluate.js';
import applyRoutes from './routes/apply.js';
import interviewRoutes from './routes/interview.js';
import trackerRoutes from './routes/tracker.js';
import { claudeService } from './services/claudeService.js';
import { authMiddleware, isAuthConfigured } from './middleware/auth.js';

const app = express();
const publicDir = path.join(SERVER_DIR, 'public');

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Same-origin by default: the frontend is served by this process. A wide-open
// cors() let any site on the internet call the API with a stolen token.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : false,
  credentials: false
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(publicDir));

app.use('/api/auth', authRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    aiConfigured: claudeService.isConfigured(),
    provider: claudeService.getProviderName(),
    authConfigured: isAuthConfigured(),
    timestamp: new Date().toISOString(),
    frameworkVersion: '1.3.4'
  });
});

app.use('/api', authMiddleware);

app.use('/api/profile', profileRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/evaluate', evaluateRoutes);
app.use('/api/apply', applyRoutes);
app.use('/api/interview', interviewRoutes);
app.use('/api/tracker', trackerRoutes);

// Unmatched API routes must answer JSON. Without this they fell through to the
// SPA catch-all and returned the HTML shell with a 200, so every client-side
// res.json() reported a confusing parse error instead of the real problem.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `No API route for ${req.method} ${req.originalUrl}` });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  if (status >= 500) console.error('Unhandled server error:', err);
  else console.warn('Request rejected:', err.message);

  res.status(status).json({
    success: false,
    error: status >= 500 ? 'Internal server error' : err.message
  });
});

export default app;
