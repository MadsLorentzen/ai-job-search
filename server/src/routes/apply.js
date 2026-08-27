import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { claudeService } from '../services/claudeService.js';
import { latexService, resolveBuildDir, assertAppId, assertDocType, ValidationError } from '../services/latexService.js';
import { storageService } from '../services/storageService.js';

const router = express.Router();

/**
 * Rebuild a document path from validated inputs.
 *
 * Deliberately does NOT read a stored path out of the application record: a
 * client could previously write an arbitrary cvPdfPath through the tracker
 * endpoint and have this route stream any file on disk back to them.
 */
function documentPath(appId, type) {
  const buildDir = resolveBuildDir(type, appId);
  return path.join(buildDir, type === 'cv' ? 'main.pdf' : 'cover.pdf');
}

router.post('/generate', async (req, res, next) => {
  try {
    const { job, fitEvaluation } = req.body || {};

    if (!job || !job.title || !job.description) {
      return res.status(400).json({
        success: false,
        error: 'Target job details (title and description) are required.'
      });
    }

    const profile = storageService.getProfile();
    const appId = uuidv4();

    const pipelineResult = await claudeService.draftAndReviewApplication(profile, job, fitEvaluation);

    const cvCompilation = await latexService.compileDocument('cv', pipelineResult.cvLatex, appId);
    const coverCompilation = await latexService.compileDocument('cover', pipelineResult.coverLetterLatex, appId);

    const clientFields = storageService.sanitizeApplicationInput({
      id: appId,
      jobTitle: job.title,
      company: job.company || 'Company',
      location: job.location || '',
      jobUrl: job.url || '',
      status: 'Drafted',
      // No invented default. Absent means "not evaluated", not "90% match".
      fitScore: fitEvaluation?.overallScore ?? null,
      cvLatex: pipelineResult.cvLatex,
      coverLetterLatex: pipelineResult.coverLetterLatex,
      auditsPassed: pipelineResult.auditsPassed || [],
      revisionsApplied: pipelineResult.revisionsApplied || [],
      reviewScore: pipelineResult.reviewScore ?? null,
      source: pipelineResult.source
    });

    const applicationRecord = await storageService.saveApplication(clientFields, {
      cvPdfPath: cvCompilation.pdfPath,
      coverPdfPath: coverCompilation.pdfPath
    });

    res.json({
      success: true,
      application: applicationRecord,
      // `source` tells the client whether a real model produced this or
      // whether it is scaffolding from the offline fallback.
      source: pipelineResult.source,
      warning: pipelineResult.warning,
      cvPdfBase64: cvCompilation.pdfBuffer.toString('base64'),
      coverPdfBase64: coverCompilation.pdfBuffer.toString('base64'),
      cvRenderer: cvCompilation.renderer,
      coverRenderer: coverCompilation.renderer,
      cvAtsVerification: cvCompilation.atsVerification,
      coverAtsVerification: coverCompilation.atsVerification,
      reviewScore: pipelineResult.reviewScore ?? null,
      auditsPassed: pipelineResult.auditsPassed || []
    });
  } catch (err) {
    next(err);
  }
});

router.post('/compile', async (req, res, next) => {
  try {
    const { type = 'cv', latexContent, appId } = req.body || {};

    if (!latexContent || typeof latexContent !== 'string') {
      return res.status(400).json({ success: false, error: 'LaTeX content is required.' });
    }

    assertDocType(type);
    // A recompile targets an existing application; a missing id gets a fresh
    // one rather than being taken on trust from the caller.
    const id = appId === undefined || appId === null || appId === '' ? uuidv4() : assertAppId(appId);

    const compilation = await latexService.compileDocument(type, latexContent, id);

    const apps = storageService.getApplications();
    const existing = apps.find(a => a.id === id);
    if (existing) {
      const clientFields = storageService.sanitizeApplicationInput({
        id,
        ...(type === 'cv' ? { cvLatex: latexContent } : { coverLetterLatex: latexContent })
      });
      await storageService.saveApplication(clientFields, {
        ...(type === 'cv' ? { cvPdfPath: compilation.pdfPath } : { coverPdfPath: compilation.pdfPath })
      });
    }

    res.json({
      success: true,
      appId: id,
      pdfBase64: compilation.pdfBuffer.toString('base64'),
      atsVerification: compilation.atsVerification,
      compilerUsed: compilation.compilerUsed,
      renderer: compilation.renderer,
      note: compilation.note,
      logs: compilation.logs
    });
  } catch (err) {
    next(err);
  }
});

router.get('/preview/:appId/:type', (req, res, next) => {
  try {
    const appId = assertAppId(req.params.appId);
    const type = assertDocType(req.params.type);

    const apps = storageService.getApplications();
    if (!apps.some(a => a.id === appId)) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const filePath = documentPath(appId, type);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'PDF not found. Recompile the document.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

const DOWNLOAD_KINDS = {
  'cv-pdf': { type: 'cv', ext: 'pdf', prefix: 'CV' },
  'cover-pdf': { type: 'cover', ext: 'pdf', prefix: 'Cover_Letter' },
  'cv-tex': { type: 'cv', ext: 'tex', prefix: 'main' },
  'cover-tex': { type: 'cover', ext: 'tex', prefix: 'cover' }
};

router.get('/download/:appId/:kind', (req, res, next) => {
  try {
    const appId = assertAppId(req.params.appId);
    const kind = DOWNLOAD_KINDS[req.params.kind];
    if (!kind) {
      throw new ValidationError(`Unknown download kind. Expected one of: ${Object.keys(DOWNLOAD_KINDS).join(', ')}.`);
    }

    const apps = storageService.getApplications();
    const app = apps.find(a => a.id === appId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const safe = (val, fallback) => String(val || fallback).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const filename = `${kind.prefix}_${safe(app.company, 'Company')}_${safe(app.jobTitle, 'Role')}.${kind.ext}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (kind.ext === 'tex') {
      const latex = kind.type === 'cv' ? app.cvLatex : app.coverLetterLatex;
      if (!latex) {
        return res.status(404).json({ success: false, error: 'No LaTeX source stored for this document.' });
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(latex);
    }

    const filePath = documentPath(appId, kind.type);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'PDF not found. Recompile the document.' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

export default router;
