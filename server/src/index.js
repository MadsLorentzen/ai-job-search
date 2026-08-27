import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import scrapeRoutes from './routes/scrape.js';
import evaluateRoutes from './routes/evaluate.js';
import applyRoutes from './routes/apply.js';
import interviewRoutes from './routes/interview.js';
import trackerRoutes from './routes/tracker.js';
import { claudeService } from './services/claudeService.js';
import { authMiddleware } from './middleware/auth.js';

import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverEnv = path.resolve(__dirname, '../.env');
const rootEnv = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(serverEnv)) dotenv.config({ path: serverEnv });
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static files
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// Auth & Health routes (unprotected)
app.use('/api/auth', authRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    aiConfigured: claudeService.isConfigured(),
    timestamp: new Date().toISOString(),
    frameworkVersion: '1.3.4'
  });
});

// Protect all remaining /api/* routes with Authentication Middleware
app.use('/api', authMiddleware);

// Protected API Routes
app.use('/api/profile', profileRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/evaluate', evaluateRoutes);
app.use('/api/apply', applyRoutes);
app.use('/api/interview', interviewRoutes);
app.use('/api/tracker', trackerRoutes);

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
  console.log(`🔒 Auth Status: ✅ Password Protection Active`);
  console.log(`🤖 AI Status:   ${claudeService.isConfigured() ? '✅ Claude Engine Active' : '⚠️ Demo Mode (Mock Active)'}`);
  console.log(`====================================================`);
});
