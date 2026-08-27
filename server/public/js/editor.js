/**
 * LaTeX source editor.
 *
 * A gutter with line numbers, tab-to-indent, and compile errors mapped onto
 * the lines they came from. Previously a bare <textarea>: when a compile
 * failed the log came back with line numbers that were never shown against
 * the source.
 *
 * Deliberately not CodeMirror. This project has no bundler, and adding one to
 * gain syntax highlighting would be a larger architectural change than the
 * feature justifies. The parts that carried the real cost (finding your place,
 * and locating a compile error) are covered here without a build step.
 */

export class LatexEditor {
  /**
   * @param {HTMLTextAreaElement} textarea existing textarea to enhance
   */
  constructor(textarea) {
    this.textarea = textarea;
    this.errors = new Map();

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'latex-editor';

    this.gutter = document.createElement('div');
    this.gutter.className = 'latex-gutter';
    this.gutter.setAttribute('aria-hidden', 'true');

    textarea.parentNode.insertBefore(this.wrapper, textarea);
    this.wrapper.appendChild(this.gutter);
    this.wrapper.appendChild(textarea);
    textarea.classList.add('latex-input');
    textarea.spellcheck = false;
    textarea.setAttribute('wrap', 'off');

    this.bind();
  }

  bind() {
    const sync = () => this.renderGutter();
    this.textarea.addEventListener('input', sync);
    this.textarea.addEventListener('scroll', () => {
      this.gutter.scrollTop = this.textarea.scrollTop;
    });

    // Tab indents instead of leaving the field. Escape restores tab-out, so
    // the editor never becomes a keyboard trap.
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.allowTabOut = true;
        return;
      }
      if (e.key !== 'Tab' || this.allowTabOut) {
        this.allowTabOut = false;
        return;
      }
      e.preventDefault();
      const { selectionStart: start, selectionEnd: end, value } = this.textarea;
      this.textarea.value = `${value.slice(0, start)}  ${value.slice(end)}`;
      this.textarea.selectionStart = this.textarea.selectionEnd = start + 2;
      this.renderGutter();
    });

    new ResizeObserver(sync).observe(this.textarea);
  }

  get value() {
    return this.textarea.value;
  }

  set value(next) {
    this.textarea.value = next || '';
    this.clearErrors();
    this.renderGutter();
  }

  renderGutter() {
    const lineCount = this.textarea.value.split('\n').length;
    const rows = [];
    for (let n = 1; n <= lineCount; n++) {
      const message = this.errors.get(n);
      rows.push(
        message
          ? `<span class="gutter-line has-error" title="${message.replace(/"/g, '&quot;')}">${n}</span>`
          : `<span class="gutter-line">${n}</span>`
      );
    }
    this.gutter.innerHTML = rows.join('');
    this.gutter.scrollTop = this.textarea.scrollTop;
  }

  clearErrors() {
    this.errors.clear();
    this.renderGutter();
  }

  /**
   * Pull `l.123` line references out of a TeX log and mark those lines.
   * Returns the messages found, so the caller can also surface them as text.
   */
  markErrorsFromLog(log) {
    this.errors.clear();
    if (!log) {
      this.renderGutter();
      return [];
    }

    const found = [];
    const lines = String(log).split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('!')) continue;

      const message = line.replace(/^!\s*/, '').trim();
      // TeX reports the offending source line a few lines later as "l.123".
      for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        const match = lines[j].match(/^l\.(\d+)/);
        if (match) {
          const lineNumber = Number(match[1]);
          this.errors.set(lineNumber, message);
          found.push({ line: lineNumber, message });
          break;
        }
      }
      if (!found.length || found[found.length - 1].message !== message) {
        found.push({ line: null, message });
      }
    }

    this.renderGutter();
    return found;
  }

  /** Scroll to a line and place the caret on it. */
  goToLine(lineNumber) {
    const lines = this.textarea.value.split('\n');
    const offset = lines.slice(0, lineNumber - 1).reduce((sum, l) => sum + l.length + 1, 0);
    this.textarea.focus();
    this.textarea.setSelectionRange(offset, offset + (lines[lineNumber - 1]?.length || 0));

    const lineHeight = parseFloat(getComputedStyle(this.textarea).lineHeight) || 18;
    this.textarea.scrollTop = Math.max(0, (lineNumber - 5) * lineHeight);
  }
}
