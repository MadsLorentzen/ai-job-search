import zlib from 'zlib';

/**
 * Universal document text extractor supporting PDF, DOCX (Word), TXT, and Markdown
 */
export function extractTextFromBuffer(buffer, mimeType = '', originalname = '') {
  const nameLower = (originalname || '').toLowerCase();
  const typeLower = (mimeType || '').toLowerCase();

  // 1. Word Document (.docx)
  if (nameLower.endsWith('.docx') || typeLower.includes('wordprocessingml') || typeLower.includes('docx')) {
    return extractTextFromDocx(buffer);
  }

  // 2. PDF Document (.pdf)
  if (nameLower.endsWith('.pdf') || typeLower.includes('pdf')) {
    return extractTextFromPdf(buffer);
  }

  // 3. Plain Text / Markdown / CSV
  return buffer.toString('utf-8').trim();
}

/**
 * Extract pristine plain text from Word .docx files (unzipping word/document.xml)
 */
export function extractTextFromDocx(buffer) {
  let fullText = '';
  let offset = 0;

  while (offset < buffer.length - 30) {
    const pkHeader = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset);
    if (pkHeader === -1) break;

    try {
      const compressionMethod = buffer.readUInt16LE(pkHeader + 8);
      const compressedSize = buffer.readUInt32LE(pkHeader + 18);
      const uncompressedSize = buffer.readUInt32LE(pkHeader + 22);
      const fileNameLen = buffer.readUInt16LE(pkHeader + 26);
      const extraFieldLen = buffer.readUInt16LE(pkHeader + 28);

      const fileNameStart = pkHeader + 30;
      const fileName = buffer.toString('utf8', fileNameStart, fileNameStart + fileNameLen);
      const dataStart = fileNameStart + fileNameLen + extraFieldLen;

      if (fileName === 'word/document.xml' || fileName === 'word/header1.xml' || fileName === 'word/footer1.xml') {
        let xmlData = '';
        if (compressionMethod === 8) {
          const compressedSlice = buffer.subarray(dataStart, dataStart + (compressedSize > 0 ? compressedSize : buffer.length - dataStart));
          xmlData = zlib.inflateRawSync(compressedSlice).toString('utf8');
        } else if (compressionMethod === 0) {
          xmlData = buffer.toString('utf8', dataStart, dataStart + uncompressedSize);
        }

        if (xmlData) {
          // Parse <w:p> paragraph boundaries and <w:t> text nodes
          const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g;
          let pMatch;
          while ((pMatch = paragraphRegex.exec(xmlData)) !== null) {
            const pXml = pMatch[0];
            // Match <w:t> and <w:t xml:space="preserve"> only. The looser
            // <w:t[\s\S]*?> also matched <w:tab/> and swallowed the text after it.
            const tMatches = pXml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
            const line = tMatches.map(t => t.replace(/<[^>]+>/g, '')).join('');
            if (line.trim()) {
              fullText += line.trim() + '\n';
            }
          }
        }
      }
    } catch (err) {
      // Continue searching next zip record
    }

    offset = pkHeader + 4;
  }

  if (fullText && fullText.trim().length > 30) {
    return fullText.trim();
  }

  // Fallback: extract any XML tags
  return buffer.toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract clean, ordered text lines from PDF files
 */
export function extractTextFromPdf(buffer) {
  let textLines = [];
  const binaryContent = buffer.toString('binary');

  // 1. Locate and decompress content streams
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

    // Skip font files and binary CMap tables
    if (decompressed.includes('/CIDInit') || decompressed.includes('/FontDescriptor') || decompressed.includes('/Type /Font')) {
      continue;
    }

    const linesBeforeStream = textLines.length;

    // Extract text blocks inside BT ... ET (Begin Text ... End Text)
    const btRegex = /BT\s*([\s\S]*?)\s*ET/g;
    let btMatch;

    while ((btMatch = btRegex.exec(decompressed)) !== null) {
      const btBlock = btMatch[1];
      let currentLine = '';

      // Match (text) Tj, (text) ' or "
      const tjRegex = /\(((?:\\\(|\\\)|[^)])*)\)\s*(?:Tj|'|")/g;
      let match;
      while ((match = tjRegex.exec(btBlock)) !== null) {
        const decoded = cleanPdfString(match[1]);
        if (decoded && isValidText(decoded)) {
          currentLine += decoded + ' ';
        }
      }

      // Match [(text) 12 (text)] TJ
      const arrayTjRegex = /\[([\s\S]*?)\]\s*TJ/g;
      while ((match = arrayTjRegex.exec(btBlock)) !== null) {
        const innerTj = match[1].match(/\(((?:\\\(|\\\)|[^)])*)\)/g) || [];
        const line = innerTj
          .map(s => cleanPdfString(s.slice(1, -1)))
          .filter(isValidText)
          .join('');
        if (line) currentLine += line + ' ';
      }

      if (currentLine.trim()) {
        textLines.push(currentLine.trim());
      }
    }

    // If this stream yielded no BT/ET blocks, parse its Tj operators directly.
    // This check used to test the global accumulator rather than this stream's
    // own output, so it silently stopped applying after the first stream.
    if (textLines.length === linesBeforeStream) {
      const tjRegex = /\(((?:\\\(|\\\)|[^)])*)\)\s*Tj/g;
      let match;
      let lineBuf = '';
      while ((match = tjRegex.exec(decompressed)) !== null) {
        const decoded = cleanPdfString(match[1]);
        if (decoded && isValidText(decoded)) {
          lineBuf += decoded + ' ';
          if (lineBuf.length > 80) {
            textLines.push(lineBuf.trim());
            lineBuf = '';
          }
        }
      }
      if (lineBuf.trim()) textLines.push(lineBuf.trim());
    }
  }

  // 2. Fallback: search for literal text blocks
  if (textLines.length === 0) {
    const literalMatches = binaryContent.match(/\(((?:\\\(|\\\)|[^)]{3,}))\)/g) || [];
    const collected = literalMatches
      .map(s => cleanPdfString(s.slice(1, -1)))
      .filter(s => s.length > 2 && /[a-zA-Z]/.test(s) && isValidText(s))
      .join(' ');
    if (collected) textLines.push(collected);
  }

  // 3. Fallback: clean ASCII printable text
  if (textLines.length === 0) {
    const printable = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
    return printable.replace(/\s+/g, ' ').trim();
  }

  return textLines.join('\n').replace(/[ \t]+/g, ' ').trim();
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

function isValidText(str) {
  if (!str) return false;
  // Ignore PDF internal keywords
  if (/^(\/F\d+|\/GS\d+|[0-9\.\s]+(?:cm|rg|RG|w|J|j|M|d|gs|Do|re|f|S))$/.test(str.trim())) return false;
  return true;
}
