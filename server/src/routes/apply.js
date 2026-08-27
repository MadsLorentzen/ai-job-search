import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';
import { claudeService } from '../services/claudeService.js';
import { latexService, resolveBuildDir, assertAppId, assertDocType, ValidationError } from '../services/latexService.js';
import { storageService } from '../services/storageService.js';
import { validateBody } from '../middleware/validate.js';
import { generateBody, compileBody } from '../validation/schemas.js';
import { loggerFor } from '../config/logger.js';

const router = express.Router();
const log = loggerFor('apply');

/**
 * Rebuild a document path from validated inputs.
 * Never reads a stored path out of the application record: a client could
 * otherwise write an arbitrary path and have it streamed back.
 */
function documentPath(appId, type) {
  return path.join(resolveBuildDir(type, appId), type === 'cv' ? 'main.pdf' : 'cover.pdf');
}

/**
 * Run the full generation pipeline, reporting each stage through `onStage`.
 * Shared by the plain JSON route and the streaming one so the two cannot
 * drift.
 */
async function runGeneration({ job, fitEvaluation, onStage }) {
  const profile = storageService.getProfile();
  const appId = uuidv4();

  onStage({ stage: 'drafter', status: 'active' });
  const pipelineResult = await claudeService.draftAndReviewApplication(profile, job, fitEvaluation);
  onStage({ stage: 'drafter', status: 'done' });
  onStage({ stage: 'reviewer', status: pipelineResult.source === 'ai' ? 'done' : 'skipped' });

  onStage({ stage: 'latex', status: 'active' });
  const cvCompilation = await latexService.compileDocument('cv', pipelineResult.cvLatex, appId);
  const coverCompilation = await latexService.compileDocument('cover', pipelineResult.coverLetterLatex, appId);
  onStage({ stage: 'latex', status: cvCompilation.renderer === 'latex' ? 'done' : 'skipped' });
  onStage({ stage: 'ats', status: cvCompilation.atsVerification?.verified ? 'done' : 'skipped' });

  const application = storageService.saveApplication({
    id: appId,
    jobTitle: job.title,
    company: job.company || '',
    location: job.location || '',
    jobUrl: job.url || '',
    status: 'Drafted',
    // No invented default: absent means "not evaluated", not "90% match".
    fitScore: typeof fitEvaluation?.overallScore === 'number' ? fitEvaluation.overallScore : null,
    reviewScore: typeof pipelineResult.reviewScore === 'number' ? pipelineResult.reviewScore : null,
    cvLatex: pipelineResult.cvLatex,
    coverLetterLatex: pipelineResult.coverLetterLatex,
    auditsPassed: pipelineResult.auditsPassed || [],
    revisionsApplied: pipelineResult.revisionsApplied || [],
    source: pipelineResult.source
  });

  storageService.addDocumentVersion(appId, 'cv', pipelineResult.cvLatex);
  storageService.addDocumentVersion(appId, 'cover', pipelineResult.coverLetterLatex);

  if (job.id) storageService.setJobState(job.id, 'applied');

  return {
    application,
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
  };
}

router.post('/generate', validateBody(generateBody), async (req, res, next) => {
  try {
    const result = await runGeneration({
      job: req.body.job,
      fitEvaluation: req.body.fitEvaluation,
      onStage: () => {}
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * Same pipeline, streamed.
 *
 * Generation regularly runs past a minute and the client previously learned
 * nothing until it finished. The server already knew each stage boundary; it
 * just never reported one.
 */
router.post('/generate/stream', validateBody(generateBody), async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  try {
    const result = await runGeneration({
      job: req.body.job,
      fitEvaluation: req.body.fitEvaluation,
      onStage: (stage) => send('stage', stage)
    });
    send('complete', { success: true, ...result });
  } catch (err) {
    log.error({ err: err.message }, 'streamed generation failed');
    send('error', { success: false, error: err.message || 'Generation failed.' });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

router.post('/compile', validateBody(compileBody), async (req, res, next) => {
  try {
    const { type, latexContent, appId } = req.body;
    // A recompile targets an existing application; a missing id gets a fresh
    // one rather than being taken on trust from the caller.
    const id = appId || uuidv4();

    const compilation = await latexService.compileDocument(type, latexContent, id);

    if (storageService.getApplication(id)) {
      storageService.saveApplication({
        id,
        ...(type === 'cv' ? { cvLatex: latexContent } : { coverLetterLatex: latexContent })
      });
      storageService.addDocumentVersion(id, type, latexContent);
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

router.get('/versions/:appId/:type', (req, res, next) => {
  try {
    const appId = assertAppId(req.params.appId);
    const type = assertDocType(req.params.type);
    res.json({ success: true, versions: storageService.getDocumentVersions(appId, type) });
  } catch (err) {
    next(err);
  }
});

router.get('/preview/:appId/:type', (req, res, next) => {
  try {
    const appId = assertAppId(req.params.appId);
    const type = assertDocType(req.params.type);

    if (!storageService.getApplication(appId)) {
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

    const app = storageService.getApplication(appId);
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
