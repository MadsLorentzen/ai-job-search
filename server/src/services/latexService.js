import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { ROOT_DIR, BUILDS_DIR, ensureDir } from '../config/env.js';
import { loggerFor } from '../config/logger.js';
import { ValidationError } from '../errors.js';

const log = loggerFor('latex');

const execFileAsync = promisify(execFile);

ensureDir(BUILDS_DIR);

export const DOC_TYPES = Object.freeze(['cv', 'cover']);
/**
 * Canonical application-id shape, shared with the validation layer.
 *
 * Deliberately hex-and-dashes rather than strict RFC 4122: the property that
 * matters here is that an id can never contribute a path separator or a shell
 * metacharacter, not which UUID version produced it. Keeping one definition
 * stops the request schema and the path guard from disagreeing about what is
 * acceptable.
 */
export const APP_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UUID_RE = APP_ID_PATTERN;

/** A Unicode-capable face, so non-Latin-1 names do not kill the render. */
const UNICODE_FONT = path.join(ROOT_DIR, 'cover_letters/OpenFonts/fonts/lato/Lato-Reg.ttf');
const UNICODE_FONT_BOLD = path.join(ROOT_DIR, 'cover_letters/OpenFonts/fonts/lato/Lato-Bol.ttf');

const A4 = Object.freeze({ width: 595.28, height: 841.89 });
const MAX_BUILD_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_BUILD_DIRS = 200;

export { ValidationError } from '../errors.js';

export function assertDocType(type) {
  if (!DOC_TYPES.includes(type)) {
    throw new ValidationError(`Unknown document type "${type}". Expected one of: ${DOC_TYPES.join(', ')}.`);
  }
  return type;
}

export function assertAppId(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new ValidationError('Invalid application id. Expected a UUID.');
  }
  return id;
}

/**
 * Resolve a build directory, refusing anything that escapes BUILDS_DIR.
 *
 * Both inputs used to flow unchecked from the request body into path.join,
 * which let a caller write arbitrary content to an arbitrary path. The id and
 * type are validated first, and the containment check is kept as a second
 * barrier so a future change to the validators cannot silently reopen this.
 */
export function resolveBuildDir(type, id) {
  assertDocType(type);
  assertAppId(id);

  const dir = path.resolve(BUILDS_DIR, `${type}_${id}`);
  const root = path.resolve(BUILDS_DIR);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new ValidationError('Resolved build path escapes the build directory.');
  }
  return dir;
}

export const latexService = {
  /**
   * Compile a document, falling back to a plain rendered PDF when no TeX
   * engine is installed. The return shape is identical either way except for
   * `atsVerification`, which reports honestly which path produced it.
   */
  async compileDocument(type, latexContent, id) {
    assertDocType(type);
    assertAppId(id);

    const buildDir = resolveBuildDir(type, id);
    ensureDir(buildDir);

    const filename = type === 'cv' ? 'main.tex' : 'cover.tex';
    const pdfFilename = type === 'cv' ? 'main.pdf' : 'cover.pdf';
    const texPath = path.join(buildDir, filename);
    const pdfPath = path.join(buildDir, pdfFilename);

    fs.writeFileSync(texPath, latexContent, 'utf-8');

    if (type === 'cover') {
      const coverClsSrc = path.join(ROOT_DIR, 'cover_letters/cover.cls');
      const openFontsSrc = path.join(ROOT_DIR, 'cover_letters/OpenFonts');
      if (fs.existsSync(coverClsSrc)) {
        fs.copyFileSync(coverClsSrc, path.join(buildDir, 'cover.cls'));
      }
      if (fs.existsSync(openFontsSrc)) {
        this.copyFolderRecursive(openFontsSrc, path.join(buildDir, 'OpenFonts'));
      }
    }

    const compiler = type === 'cv' ? 'lualatex' : 'xelatex';

    try {
      // execFile, not exec: arguments never reach a shell, so a crafted path
      // cannot break out into shell metacharacters.
      const { stdout } = await execFileAsync(
        compiler,
        ['-interaction=nonstopmode', '-halt-on-error', filename],
        { cwd: buildDir, timeout: 20000, maxBuffer: 10 * 1024 * 1024 }
      );

      if (fs.existsSync(pdfPath)) {
        const pdfBuffer = fs.readFileSync(pdfPath);
        const atsVerification = await this.verifyPdfAts(pdfPath);
        this.pruneOldBuilds();
        return {
          success: true,
          pdfBuffer,
          texPath,
          pdfPath,
          compilerUsed: compiler,
          renderer: 'latex',
          atsVerification,
          logs: stdout
        };
      }
    } catch (compileErr) {
      log.warn({ compiler, err: compileErr.message }, 'compilation failed or binary not found');
    }

    const fallback = await this.generateFallbackPdf(type, latexContent);
    fs.writeFileSync(pdfPath, fallback.buffer);
    this.pruneOldBuilds();

    return {
      success: true,
      pdfBuffer: fallback.buffer,
      texPath,
      pdfPath,
      compilerUsed: 'pdf-lib',
      renderer: 'fallback',
      truncated: fallback.truncated,
      atsVerification: {
        // Honest: nothing verified this document's text layer. The previous
        // revision returned pass:true with a hardcoded character count here.
        verified: false,
        reason: `No TeX engine available (${compiler} not found). This is a preview render, not a publication-quality PDF.`,
        engine: 'none'
      },
      note: fallback.truncated
        ? `Preview render only, and content was truncated at ${fallback.pages} page(s). Compile the .tex with ${compiler} for the real document.`
        : `Preview render only. Compile the .tex with ${compiler} for the real document.`,
      logs: ''
    };
  },

  /**
   * Run the repo's PDF text-layer checker and report what it actually said.
   * A failure is reported as a failure; it used to return pass:true from its
   * own catch block, which made the check incapable of ever failing.
   */
  async verifyPdfAts(pdfPath) {
    const verifyScript = path.join(ROOT_DIR, 'tools/verify_pdf.py');
    if (!fs.existsSync(verifyScript)) {
      return { verified: false, reason: 'tools/verify_pdf.py not found.', engine: 'none' };
    }

    for (const python of ['python3', 'python']) {
      try {
        const { stdout } = await execFileAsync(
          python,
          [verifyScript, pdfPath, '--min-chars', '100'],
          { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }
        );
        return {
          verified: true,
          pass: true,
          details: stdout.trim(),
          engine: `${python} tools/verify_pdf.py`
        };
      } catch (err) {
        if (err.code === 'ENOENT') continue; // try the next interpreter
        return {
          verified: true,
          pass: false,
          details: (err.stdout || err.stderr || err.message || '').trim(),
          engine: `${python} tools/verify_pdf.py`
        };
      }
    }

    return { verified: false, reason: 'No Python interpreter available.', engine: 'none' };
  },

  async embedFonts(pdfDoc) {
    // Prefer the repo's own Lato, which covers Latin Extended. StandardFonts
    // are WinAnsi-only and throw outright on characters such as "ł".
    if (fs.existsSync(UNICODE_FONT)) {
      try {
        pdfDoc.registerFontkit(fontkit);
        const regular = await pdfDoc.embedFont(fs.readFileSync(UNICODE_FONT), { subset: true });
        const bold = fs.existsSync(UNICODE_FONT_BOLD)
          ? await pdfDoc.embedFont(fs.readFileSync(UNICODE_FONT_BOLD), { subset: true })
          : regular;
        return { regular, bold, unicode: true };
      } catch (err) {
        log.warn({ err: err.message }, 'unicode font embedding failed, falling back to Helvetica');
      }
    }
    return {
      regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      unicode: false
    };
  },

  /**
   * Render a readable preview PDF from the LaTeX source.
   * Paginates rather than silently dropping everything past page one.
   */
  async generateFallbackPdf(type, latexContent) {
    const pdfDoc = await PDFDocument.create();
    const { regular, bold, unicode } = await this.embedFonts(pdfDoc);

    const margin = 40;
    const bottom = 50;
    let page = pdfDoc.addPage([A4.width, A4.height]);
    let y = A4.height - margin;
    let pages = 1;

    const sanitize = (text) => {
      if (unicode) return text;
      // Helvetica cannot encode outside WinAnsi. Rather than throwing away the
      // whole request, drop the unrepresentable glyphs and keep the document.
      // eslint-disable-next-line no-control-regex
      return text.replace(/[^\x00-\xFF]/g, '?');
    };

    const newPage = () => {
      page = pdfDoc.addPage([A4.width, A4.height]);
      y = A4.height - margin;
      pages += 1;
    };

    const draw = (text, { size = 9.5, font = regular, color = rgb(0.2, 0.25, 0.3), x = margin, lead = 13 } = {}) => {
      if (y < bottom) newPage();
      try {
        page.drawText(sanitize(text), { x, y, size, font, color });
      } catch (err) {
        log.warn({ err: err.message }, 'skipped an unrenderable line in the preview PDF');
      }
      y -= lead;
    };

    draw(type === 'cv' ? 'CURRICULUM VITAE' : 'COVER LETTER', {
      size: 18, font: bold, color: rgb(0.1, 0.25, 0.5), lead: 25
    });
    page.drawLine({
      start: { x: margin, y: y + 8 },
      end: { x: A4.width - margin, y: y + 8 },
      thickness: 1,
      color: rgb(0.8, 0.85, 0.9)
    });
    y -= 12;

    for (const line of this.extractCleanTextFromLatex(latexContent)) {
      const trimmed = line.trim();
      if (!trimmed) { y -= 8; continue; }

      const isHeading = trimmed.startsWith('##') || (trimmed.toUpperCase() === trimmed && trimmed.length < 30);

      if (isHeading) {
        y -= 6;
        draw(trimmed.replace(/^#+\s*/, ''), { size: 12, font: bold, color: rgb(0.12, 0.2, 0.35), lead: 16 });
      } else if (trimmed.startsWith('•') || trimmed.startsWith('-')) {
        const wrapped = this.wrapText(trimmed.replace(/^[•\-]\s*/, ''), 75);
        wrapped.forEach((w, i) => draw(i === 0 ? `• ${w}` : `  ${w}`, { x: margin + 10 }));
      } else {
        this.wrapText(trimmed, 80).forEach(w => draw(w));
        y -= 4;
      }
    }

    const bytes = await pdfDoc.save();
    return {
      // pdf-lib returns a Uint8Array. Uint8Array#toString ignores its argument,
      // so calling .toString('base64') on it downstream produced a string of
      // comma-joined byte values instead of base64.
      buffer: Buffer.from(bytes),
      pages,
      truncated: false
    };
  },

  extractCleanTextFromLatex(latex) {
    return String(latex || '')
      .replace(/\\documentclass[\s\S]*?\\begin\{document\}/, '')
      .replace(/\\end\{document\}/, '')
      .replace(/\\makecvtitle/, '')
      .replace(/\\namesection\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}/g, '$1 $2 | $3')
      .replace(/\\name\{([^}]+)\}\{([^}]+)\}/g, '$1 $2')
      .replace(/\\title\{([^}]+)\}/g, '$1')
      .replace(/\\address\{([^}]+)\}.*$/gm, '$1')
      .replace(/\\phone\[[^\]]*\]\{([^}]+)\}/g, 'Phone: $1')
      .replace(/\\email\{([^}]+)\}/g, 'Email: $1')
      .replace(/\\section\{([^}]+)\}/g, '\n## $1\n')
      .replace(/\\cventry\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}\{.*\}\{/g, '$2 at $3 ($1)\n')
      .replace(/\\cvitem\{([^}]+)\}\{([^}]+)\}/g, '$1: $2')
      .replace(/\\lettercontent\{([^}]+)\}/g, '$1\n')
      .replace(/\\closing\{([^}]+)\}/g, '\n$1')
      .replace(/\\signature\{([^}]+)\}/g, '$1')
      .replace(/\\companyname\{([^}]+)\}/g, 'To: $1')
      .replace(/\\companyaddress\{([^}]+)\}/g, '$1')
      .replace(/\\item\s+/g, '• ')
      .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{([^}]*)\})?/g, '$3')
      .replace(/\\\\/g, '\n')
      .replace(/\\&/g, '&')
      .replace(/\\%/g, '%')
      .replace(/\\_/g, '_')
      .replace(/\\#/g, '#')
      .replace(/[{}]/g, '')
      .split('\n');
  },

  wrapText(text, maxChars) {
    const words = String(text).split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length > maxChars) {
        if (currentLine) lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine = (currentLine + ' ' + word).trim();
      }
    }
    if (currentLine) lines.push(currentLine.trim());
    return lines;
  },

  /** Keep the build directory from growing without bound. */
  pruneOldBuilds() {
    try {
      const entries = fs.readdirSync(BUILDS_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => {
          const full = path.join(BUILDS_DIR, e.name);
          return { full, mtime: fs.statSync(full).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);

      const now = Date.now();
      entries.forEach((entry, index) => {
        if (index >= MAX_BUILD_DIRS || now - entry.mtime > MAX_BUILD_AGE_MS) {
          fs.rmSync(entry.full, { recursive: true, force: true });
        }
      });
    } catch (err) {
      log.warn({ err: err.message }, 'build directory prune skipped');
    }
  },

  copyFolderRecursive(source, target) {
    ensureDir(target);
    for (const file of fs.readdirSync(source)) {
      const curSource = path.join(source, file);
      const curTarget = path.join(target, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        this.copyFolderRecursive(curSource, curTarget);
      } else {
        fs.copyFileSync(curSource, curTarget);
      }
    }
  }
};
