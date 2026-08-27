import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { claudeService } from '../services/claudeService.js';
import { latexService } from '../services/latexService.js';
import { storageService } from '../services/storageService.js';

const router = express.Router();

// Generate tailored CV and Cover Letter using Drafter -> Reviewer loop
router.post('/generate', async (req, res) => {
  try {
    const { job, fitEvaluation } = req.body;
    if (!job || !job.title || !job.description) {
      return res.status(400).json({
        success: false,
        error: 'Target job details (title, company, description) are required.'
      });
    }

    const profile = storageService.getProfile();
    const appId = uuidv4();

    console.log(`Starting Drafter -> Reviewer LaTeX Generation Pipeline [${appId}]...`);

    // Step 1 & 2: Drafter and Reviewer agents
    const pipelineResult = await claudeService.draftAndReviewApplication(profile, job, fitEvaluation);

    // Step 3: Compile both documents to PDF
    console.log(`Compiling tailored CV with LuaLaTeX...`);
    const cvCompilation = await latexService.compileDocument('cv', pipelineResult.cvLatex, appId);

    console.log(`Compiling tailored Cover Letter with XeLaTeX...`);
    const coverCompilation = await latexService.compileDocument('cover', pipelineResult.coverLetterLatex, appId);

    // Step 4: Persist in application tracker
    const applicationRecord = {
      id: appId,
      jobTitle: job.title,
      company: job.company || 'Company',
      location: job.location || 'Remote',
      jobUrl: job.url || '',
      status: 'Drafted',
      fitScore: fitEvaluation?.overallScore || 90,
      fitVerdict: fitEvaluation?.verdict || 'Strong Match',
      cvLatex: pipelineResult.cvLatex,
      coverLetterLatex: pipelineResult.coverLetterLatex,
      reviewScore: pipelineResult.reviewScore,
      auditsPassed: pipelineResult.auditsPassed,
      revisionsApplied: pipelineResult.revisionsApplied,
      cvPdfPath: cvCompilation.pdfPath,
      coverPdfPath: coverCompilation.pdfPath,
      cvTexPath: cvCompilation.texPath,
      coverTexPath: coverCompilation.texPath,
      atsVerification: cvCompilation.atsVerification,
      createdAt: new Date().toISOString()
    };

    storageService.saveApplication(applicationRecord);

    res.json({
      success: true,
      application: applicationRecord,
      cvPdfBase64: cvCompilation.pdfBuffer.toString('base64'),
      coverPdfBase64: coverCompilation.pdfBuffer.toString('base64'),
      cvAts: cvCompilation.atsVerification,
      coverAts: coverCompilation.atsVerification,
      reviewScore: pipelineResult.reviewScore,
      auditsPassed: pipelineResult.auditsPassed,
      revisionsApplied: pipelineResult.revisionsApplied
    });
  } catch (err) {
    console.error('Application generation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Recompile modified LaTeX on demand
router.post('/compile', async (req, res) => {
  try {
    const { type = 'cv', latexContent, appId = uuidv4() } = req.body;
    if (!latexContent) {
      return res.status(400).json({ success: false, error: 'LaTeX content is required to compile.' });
    }

    const compilation = await latexService.compileDocument(type, latexContent, appId);

    res.json({
      success: true,
      pdfBase64: compilation.pdfBuffer.toString('base64'),
      atsVerification: compilation.atsVerification,
      compilerUsed: compilation.compilerUsed,
      logs: compilation.logs
    });
  } catch (err) {
    console.error('Recompilation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download compiled PDF or raw .tex file
router.get('/download/:appId/:type', (req, res) => {
  try {
    const { appId, type } = req.params; // type: cv-pdf, cover-pdf, cv-tex, cover-tex
    const apps = storageService.getApplications();
    const app = apps.find(a => a.id === appId);

    if (!app) {
      return res.status(404).send('Application not found');
    }

    const safeCompany = (app.company || 'Company').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeRole = (app.jobTitle || 'Role').replace(/[^a-zA-Z0-9_-]/g, '_');

    if (type === 'cv-pdf' && app.cvPdfPath && fs.existsSync(app.cvPdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="CV_${safeCompany}_${safeRole}.pdf"`);
      return fs.createReadStream(app.cvPdfPath).pipe(res);
    }

    if (type === 'cover-pdf' && app.coverPdfPath && fs.existsSync(app.coverPdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Cover_Letter_${safeCompany}_${safeRole}.pdf"`);
      return fs.createReadStream(app.coverPdfPath).pipe(res);
    }

    if (type === 'cv-tex') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="main_${safeCompany}_${safeRole}.tex"`);
      return res.send(app.cvLatex);
    }

    if (type === 'cover-tex') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="cover_${safeCompany}_${safeRole}.tex"`);
      return res.send(app.coverLetterLatex);
    }

    res.status(404).send('Requested document file not found on server');
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).send('Error downloading document: ' + err.message);
  }
});

export default router;
