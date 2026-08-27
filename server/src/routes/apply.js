import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { claudeService } from '../services/claudeService.js';
import { latexService } from '../services/latexService.js';
import { storageService } from '../services/storageService.js';

const router = express.Router();

// Generate tailored CV and Cover Letter with dual-agent Drafter/Reviewer loop
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
      cvLatex: pipelineResult.cvLatex,
      coverLetterLatex: pipelineResult.coverLetterLatex,
      cvPdfPath: cvCompilation.pdfPath,
      coverPdfPath: coverCompilation.pdfPath,
      auditsPassed: pipelineResult.auditsPassed || [],
      revisionsApplied: pipelineResult.revisionsApplied || [],
      reviewScore: pipelineResult.reviewScore || 95,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    storageService.saveApplication(applicationRecord);

    res.json({
      success: true,
      application: applicationRecord,
      cvPdfBase64: cvCompilation.pdfBuffer.toString('base64'),
      coverPdfBase64: coverCompilation.pdfBuffer.toString('base64'),
      cvCompilationLogs: cvCompilation.logs,
      coverCompilationLogs: coverCompilation.logs,
      reviewScore: pipelineResult.reviewScore || 95,
      auditsPassed: pipelineResult.auditsPassed || []
    });

  } catch (err) {
    console.error('Application generation error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Error generating tailored application documents.'
    });
  }
});

// Recompile customized LaTeX from browser editor
router.post('/compile', async (req, res) => {
  try {
    const { type, latexContent, appId = uuidv4() } = req.body;
    
    if (!latexContent) {
      return res.status(400).json({ success: false, error: 'LaTeX content is required' });
    }

    const compilation = await latexService.compileDocument(type || 'cv', latexContent, appId);

    // If appId matches an existing application, update it
    const apps = storageService.getApplications();
    const appIndex = apps.findIndex(a => a.id === appId);
    if (appIndex !== -1) {
      if (type === 'cv') {
        apps[appIndex].cvLatex = latexContent;
        apps[appIndex].cvPdfPath = compilation.pdfPath;
      } else {
        apps[appIndex].coverLetterLatex = latexContent;
        apps[appIndex].coverPdfPath = compilation.pdfPath;
      }
      apps[appIndex].updatedAt = new Date().toISOString();
      storageService.saveApplication(apps[appIndex]);
    }

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

// Stream inline PDF for native in-browser viewing
router.get('/preview/:appId/:type', (req, res) => {
  try {
    const { appId, type } = req.params; // type: cv, cover
    const apps = storageService.getApplications();
    const app = apps.find(a => a.id === appId);

    if (!app) {
      return res.status(404).send('Application not found');
    }

    const filePath = type === 'cover' ? app.coverPdfPath : app.cvPdfPath;
    if (filePath && fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      return fs.createReadStream(filePath).pipe(res);
    }

    res.status(404).send('PDF file not found on server');
  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).send('Error previewing document: ' + err.message);
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
