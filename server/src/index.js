import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import profileRoutes from './routes/profile.js';
import scrapeRoutes from './routes/scrape.js';
import evaluateRoutes from './routes/evaluate.js';
import applyRoutes from './routes/apply.js';
import interviewRoutes from './routes/interview.js';
import trackerRoutes from './routes/tracker.js';
import { claudeService } from './services/claudeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static files
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// API Routes
app.use('/api/profile', profileRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/evaluate', evaluateRoutes);
app.use('/api/apply', applyRoutes);
app.use('/api/interview', interviewRoutes);
app.use('/api/tracker', trackerRoutes);

// Health & Status endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    aiConfigured: claudeService.isConfigured(),
    timestamp: new Date().toISOString(),
    frameworkVersion: '1.3.4'
  });
});

// Single Page App Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🎯 AI Job Search Web App is running!`);
  console.log(`📡 Local URL:   http://localhost:${PORT}`);
  console.log(`🌐 Network URL: http://0.0.0.0:${PORT}`);
  console.log(`🤖 AI Status:   ${claudeService.isConfigured() ? '✅ Claude API Active' : '⚠️ No API Key in .env (Mock Mode Enabled)'}`);
  console.log(`====================================================`);
});
