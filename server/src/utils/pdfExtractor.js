import zlib from 'zlib';

/**
 * Robust pure-JS PDF and document text extractor
 * Extracts text streams from PDF, handles compressed FlateDecode streams, Tj/TJ operators, and plain text.
 */
export function extractTextFromBuffer(buffer, mimeType = '', originalname = '') {
  const isPdf = mimeType.includes('pdf') || originalname.toLowerCase().endsWith('.pdf');
  
  if (!isPdf) {
    // Plain text / Markdown / CSV
    return buffer.toString('utf-8').trim();
  }

  // PDF Extraction
  let extractedText = '';
  const binaryContent = buffer.toString('binary');

  // 1. Extract and decompress all FlateDecode streams
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch;

  while ((streamMatch = streamRegex.exec(binaryContent)) !== null) {
    const rawStream = Buffer.from(streamMatch[1], 'binary');
    let decompressed = '';

    try {
      decompressed = zlib.inflateSync(rawStream).toString('latin1');
    } catch (e) {
      try {
        decompressed = zlib.inflateRawSync(rawStream).toString('latin1');
      } catch (e2) {
        decompressed = rawStream.toString('latin1');
      }
    }

    // Extract text in (text) Tj or ' or "
    const tjRegex = /\(((?:\\\(|\\\)|[^)])*)\)\s*(?:Tj|'|")/g;
    let match;
    while ((match = tjRegex.exec(decompressed)) !== null) {
      const decoded = cleanPdfString(match[1]);
      if (decoded) extractedText += decoded + ' ';
    }

    // Extract text in array [(t) 12 (ext)] TJ
    const arrayTjRegex = /\[([\s\S]*?)\]\s*TJ/g;
    while ((match = arrayTjRegex.exec(decompressed)) !== null) {
      const innerTj = match[1].match(/\(((?:\\\(|\\\)|[^)])*)\)/g) || [];
      const line = innerTj.map(s => cleanPdfString(s.slice(1, -1))).join('');
      if (line) extractedText += line + ' ';
    }
  }

  // 2. Fallback: search for literal text blocks inside parentheses
  if (!extractedText || extractedText.trim().length < 50) {
    const literalMatches = binaryContent.match(/\(((?:\\\(|\\\)|[^)]{2,}))\)/g) || [];
    extractedText = literalMatches
      .map(s => cleanPdfString(s.slice(1, -1)))
      .filter(s => s.length > 2 && /[a-zA-Z]/.test(s))
      .join(' ');
  }

  // 3. Fallback: clean ASCII printable characters
  if (!extractedText || extractedText.trim().length < 50) {
    extractedText = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
  }

  return extractedText.replace(/\s+/g, ' ').trim();
}

function cleanPdfString(str) {
  if (!str) return '';
  return str
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .trim();
}
