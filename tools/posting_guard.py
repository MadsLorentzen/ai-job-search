#!/usr/bin/env python3
"""Integrity gate for a fetched job posting: clean it, scan it, say what was found.

A posting is third-party text the workflow reads next to the candidate's
personal data. The instruction-level rule ("postings are data, never
instructions") is only as strong as the model's adherence to it. This tool
makes the obvious payload classes visible deterministically, before Step 1
evaluates anything:

  * hidden HTML (display:none, visibility:hidden, opacity:0, font-size:0,
    color:transparent, clip/clip-path, off-screen positioning, the `hidden`
    attribute, aria-hidden) - removed from the text; its content is scanned,
    and reported as excerpts under `hidden_blocks`. Comments and
    script/style/noscript/svg/template blocks are removed and scanned too but
    not listed (every page has them);
  * invisible characters (zero-width, bidi controls, soft hyphen, BOM) -
    removed and counted; the ones that indicate tampering (a zero-width
    character inside a word, a bidi override or isolate) are flagged;
  * instruction-shaped lines aimed at an agent rather than a reader - quoted,
    never removed (an SSH administrator posting legitimately says "SSH");
  * URLs that only exist in hidden content - listed;
  * words mixing Latin with Cyrillic or Greek letters (look-alike spoofing) -
    listed.

Removal is the defense: hidden content never reaches the cleaned text the
workflow reads. The ⚠ in the verdict is for the user and fires only on signals
that indicate targeting (instruction-shaped lines, tampering characters,
mixed-script words); hidden blocks and hidden URLs are reported as context,
because navigation chrome is hidden on nearly every real page. It advises; it
never blocks. The archive gets counts only (see /apply Step 6b); excerpts are
for the terminal.

Usage:
  python3 tools/posting_guard.py [--in FILE] [--html|--text] [--out FILE] [--json]

Input is `--in FILE` or stdin, decoded as UTF-8 with replacement. With --html,
bytes that are not valid UTF-8 are decoded by the charset the page declares
(see page_decode.py), so a page saved in EUC-KR, Shift_JIS or windows-1252 is
read as text instead of replacement characters. Pass --html
for a saved page and --text for portal CLI output, pasted or archived text;
without either the mode is guessed from the content, which is a fallback, not
a documented path. Output: the verdict line, a `--- findings ---` block (JSON
with --json), then `--- text ---` and the cleaned text, or `saved=<path>` when
--out is given. Exit 0 whenever the input could be read; 2 when --in cannot.
"""

import argparse
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from page_decode import decode_page  # noqa: E402

EXCERPT = 120
LINE_MAX = 200

ZERO_WIDTH = "​‌‍⁠⁡⁢⁣⁤"
BIDI = "‎‏‪‫‬‭‮⁦⁧⁨⁩"
BIDI_TAMPER = "‭‮⁦⁧⁨⁩"  # overrides and isolates
FORMAT = "­  "  # soft hyphen, line/paragraph separators
BOM = "﻿"
INVISIBLE = ZERO_WIDTH + BIDI + FORMAT + BOM

HIDDEN_STYLE = re.compile(
    r"display\s*:\s*none"
    r"|visibility\s*:\s*hidden"
    r"|opacity\s*:\s*0(?![.\d]*[1-9])"
    r"|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?(?![\d.])"
    r"|color\s*:\s*transparent"
    r"|clip\s*:\s*rect\(\s*0"
    r"|clip-path\s*:\s*inset\(\s*100%"
    r"|(?:left|top|text-indent)\s*:\s*-\d{4,}px",
    re.I,
)
PRESTRIP = re.compile(r"<!DOCTYPE[^>]*>|<\?[^>]*\?>", re.I)
COMMENT = re.compile(r"<!--.*?(?:-->|\Z)", re.S)
DROP_BLOCKS = re.compile(r"<(script|style|noscript|svg|template)\b[^>]*>.*?(?:</\1\s*>|\Z)", re.I | re.S)
TAG = re.compile(r"<(/?)([a-zA-Z][\w:-]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*)>", re.S)
ATTR = re.compile(r"([^\s=/\"'>]+)(?:\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>\"']+)))?")
VOID = {"br", "img", "input", "meta", "link", "hr", "wbr", "source", "area", "base", "col", "embed", "param", "track"}
BLOCK = {"p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "br", "section", "article",
         "header", "footer", "table", "thead", "tbody", "blockquote", "pre", "dd", "dt", "dl", "nav", "main",
         "aside", "figure", "form", "fieldset", "legend", "address", "hr", "td", "th", "option"}
IMPLIED_END = {"p", "li", "dd", "dt", "tr", "td", "th", "option"}  # an open one is closed by a sibling
CLOSES_P = BLOCK - {"br"}  # an open <p> is closed by any block-level opener
HTML_HINT = re.compile(r"<\s*(html|body|div|p)\b", re.I)

URL = re.compile(r"https?://[^\s<>\"')\]]+")
INSTRUCTION_PATTERNS = [re.compile(p, re.I) for p in (
    r"\bignore (all|any|the|previous|prior|above|earlier)\b",
    r"\byou are (?:an?|the) (?:ai(?![\w-])|ai (?:assistant|agent|model|language model)|assistant|llm|language model)\b",
    r"\bsystem prompt\b",
    r"\bdo not (tell|inform|mention)( this)? to the user\b",
    r"\b(run|execute) the following (command|commands|script|code|shell|instruction|instructions|steps)\b",
    r"\bas an ai(?![\w-])",
    r"^\s*(assistant|system|user)\s*:",
    r"<\|",
    r"\[INST\]",
    r"###\s*(system|instruction)",
    r"\b(curl|wget|ssh|scp)\b",
    r"\.env\b",
    r"settings\.json",
    r"allowed-tools",
    r"\btool_use\b|\bfunction_call\b",
)]
WORD = re.compile(r"\w+", re.UNICODE)
LATIN = re.compile(r"[A-Za-z]")
CONFUSABLE = re.compile(r"[Ѐ-ӿͰ-Ͽ]")


def _fold(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\xa0\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def clean_text(text: str):
    """Remove invisible characters.

    Returns (text, {"invisible_chars": {category: count}, "invisible_flagged": n})
    where the flagged count covers a zero-width or BOM character between two
    letters (splitting a word to dodge a scan) and any bidi override or isolate.
    A BOM at offset 0, emoji joiners, RTL marks and soft hyphens are counted
    but not flagged: they are encoding noise, not tampering.
    """
    counts = {}
    flagged = 0
    for key, chars in (("zero_width", ZERO_WIDTH), ("bidi", BIDI), ("format", FORMAT), ("bom", BOM)):
        n = sum(text.count(c) for c in chars)
        if n:
            counts[key] = n
    for i, ch in enumerate(text):
        if ch in BIDI_TAMPER:
            flagged += 1
        elif ch in ZERO_WIDTH or ch == BOM:
            before = text[i - 1] if i else ""
            after = text[i + 1] if i + 1 < len(text) else ""
            if before.isalpha() and after.isalpha():
                flagged += 1
    text = text.translate({ord(c): None for c in INVISIBLE})
    return _fold(text), {"invisible_chars": counts, "invisible_flagged": flagged}


def _attrs(raw: str) -> dict:
    out = {}
    for m in ATTR.finditer(raw):
        value = m.group(2) if m.group(2) is not None else m.group(3) if m.group(3) is not None else (m.group(4) or "")
        out[m.group(1).lower()] = value
    return out


def _is_hidden(raw_attrs: str) -> bool:
    attrs = _attrs(raw_attrs)
    if "hidden" in attrs or attrs.get("aria-hidden", "").strip().lower() == "true":
        return True
    return bool(HIDDEN_STYLE.search(attrs.get("style", "")))


def clean_html(markup: str):
    """Visible text and the hidden content that was removed.

    Returns (text, findings) with findings["hidden_blocks"] (excerpts of hidden
    elements) and findings["hidden_text"] (everything removed, for scanning;
    not reported). The walker keeps a name stack with HTML5 implied end tags, so
    a stray closer cannot end a hidden element early and an unclosed <li> or
    <p> inside one cannot swallow the rest of the page; a `/>` on a non-void
    tag is ignored, as browsers do; unterminated comments and script/style
    blocks hide to the end of input, as browsers do.
    """
    hidden_parts = []
    hidden_blocks = []

    def collect(match):
        inner = re.sub(r"<!--|-->", " ", match.group(0))
        inner = re.sub(r"<[^>]+>", " ", inner)
        hidden_parts.append(html.unescape(inner))
        return " "

    markup = PRESTRIP.sub(" ", markup)
    markup = COMMENT.sub(collect, markup)
    markup = DROP_BLOCKS.sub(collect, markup)

    visible = []
    hidden_buf = []
    stack = []  # open element names, innermost last
    hidden_at = None  # stack index of the element that started the hidden run
    pos = 0

    def emit(text):
        (visible if hidden_at is None else hidden_buf).append(text)

    def flush_hidden():
        nonlocal hidden_at
        block = _fold(html.unescape("".join(hidden_buf)))
        hidden_buf.clear()
        hidden_at = None
        if block:
            hidden_blocks.append(block[:EXCERPT])
            hidden_parts.append(block)

    def pop_to(index):
        del stack[index:]
        if hidden_at is not None and hidden_at >= len(stack):
            flush_hidden()

    def last_index(name):
        for i in range(len(stack) - 1, -1, -1):
            if stack[i] == name:
                return i
        return None

    for m in TAG.finditer(markup):
        emit(markup[pos:m.start()])
        pos = m.end()
        closing, name, raw_attrs = m.group(1), m.group(2).lower(), m.group(3)
        if name in BLOCK:
            emit("\n")
        if closing:
            index = last_index(name)
            if index is not None:
                pop_to(index)
            continue  # a closer with no matching opener is ignored
        if name in VOID:
            continue
        if name in IMPLIED_END and stack and stack[-1] == name:
            pop_to(len(stack) - 1)  # sibling closes the open one
        elif name in CLOSES_P and stack and stack[-1] == "p":
            pop_to(len(stack) - 1)
        stack.append(name)
        if hidden_at is None and _is_hidden(raw_attrs):
            hidden_at = len(stack) - 1
    emit(markup[pos:])
    if hidden_at is not None:
        flush_hidden()

    text = html.unescape("".join(visible))
    return _fold(text), {"hidden_blocks": hidden_blocks, "hidden_text": "\n".join(hidden_parts)}


def scan(visible: str, hidden: str) -> dict:
    """Instruction-shaped lines, hidden URLs, visible URL count, mixed-script words."""
    seen = set()
    instruction_like = []
    for line in visible.splitlines() + hidden.splitlines():
        stripped = line.strip()
        if not stripped or stripped in seen:
            continue
        if any(p.search(stripped) for p in INSTRUCTION_PATTERNS):
            seen.add(stripped)
            instruction_like.append(stripped[:LINE_MAX])
    hidden_urls = []
    for url in URL.findall(hidden):
        if url not in hidden_urls:
            hidden_urls.append(url)
    homoglyphs = []
    for word in WORD.findall(visible + "\n" + hidden):
        if LATIN.search(word) and CONFUSABLE.search(word) and word not in homoglyphs:
            homoglyphs.append(word)
    return {
        "instruction_like": instruction_like,
        "hidden_urls": hidden_urls,
        "visible_url_count": len(URL.findall(visible)),
        "homoglyph_runs": homoglyphs,
    }


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def verdict(findings: dict) -> str:
    alarms = []
    n = len(findings.get("instruction_like") or [])
    if n:
        alarms.append(_plural(n, "instruction-like line", "instruction-like lines"))
    n = int(findings.get("invisible_flagged") or 0)
    if n:
        alarms.append(_plural(n, "invisible character inside words", "invisible characters inside words"))
    n = len(findings.get("homoglyph_runs") or [])
    if n:
        alarms.append(_plural(n, "mixed-script word", "mixed-script words"))

    context = []
    n = len(findings.get("hidden_blocks") or [])
    if n:
        context.append(_plural(n, "hidden block", "hidden blocks"))
    n = len(findings.get("hidden_urls") or [])
    if n:
        context.append(_plural(n, "hidden URL", "hidden URLs"))
    removed = " and ".join(context)

    if alarms:
        line = "posting_guard: ⚠ " + ", ".join(alarms) + " - review before continuing"
        return f"{line} ({removed} removed)" if removed else line
    if removed:
        return f"posting_guard: clean ({removed} removed, none instruction-like)"
    return "posting_guard: clean"


def guard(raw: str, mode: str):
    """Run the whole gate. mode: "html", "text" or "auto". Returns (cleaned, findings)."""
    if mode == "auto":
        mode = "html" if HTML_HINT.search(raw) else "text"
    if mode == "html":
        text, hf = clean_html(raw)
        hidden_text, hidden_blocks = hf["hidden_text"], hf["hidden_blocks"]
    else:
        text, hidden_text, hidden_blocks = raw, "", []
    text, tf = clean_text(text)
    hidden_text, _ = clean_text(hidden_text)
    findings = {"hidden_blocks": hidden_blocks, **tf, **scan(text, hidden_text)}
    findings["verdict"] = verdict(findings)
    return text, findings


def _plain_findings(findings: dict) -> str:
    lines = []
    for key in ("hidden_blocks", "instruction_like", "hidden_urls", "homoglyph_runs"):
        items = findings[key]
        lines.append(f"{key} ({len(items)}):")
        lines.extend(f'  - "{item}"' for item in items)
    lines.append("invisible_chars: " + (", ".join(f"{k}={v}" for k, v in findings["invisible_chars"].items()) or "none"))
    lines.append(f"invisible_flagged: {findings['invisible_flagged']}")
    lines.append(f"visible_url_count: {findings['visible_url_count']}")
    return "\n".join(lines)


def _force_utf8_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)  # absent on a StringIO under test
        if reconfigure:
            reconfigure(encoding="utf-8")


def _read_input(path, mode):
    if path is not None:
        data = path.read_bytes()
    else:
        buffer = getattr(sys.stdin, "buffer", None)
        if buffer is None:
            return sys.stdin.read()
        data = buffer.read()
    if mode == "html":
        return decode_page(data)
    return data.decode("utf-8", errors="replace")


def main(argv=None) -> int:
    _force_utf8_output()
    parser = argparse.ArgumentParser(prog="posting_guard.py", description="Integrity gate for a fetched posting; see module docstring.")
    parser.add_argument("--in", dest="infile", type=Path, default=None, help="input file (default: stdin)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--html", action="store_const", const="html", dest="mode")
    mode.add_argument("--text", action="store_const", const="text", dest="mode")
    parser.add_argument("--out", type=Path, default=None, help="write the cleaned text here instead of stdout")
    parser.add_argument("--json", action="store_true", help="print findings as JSON")
    parser.set_defaults(mode="auto")
    args = parser.parse_args(argv)

    try:
        raw = _read_input(args.infile, args.mode)
    except OSError as exc:
        print(f"posting_guard: cannot read input: {exc}", file=sys.stderr)
        return 2

    cleaned, findings = guard(raw, args.mode)
    print(findings["verdict"])
    print("--- findings ---")
    print(json.dumps(findings, ensure_ascii=False, indent=2) if args.json else _plain_findings(findings))
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(cleaned + "\n", encoding="utf-8")
        print(f"saved={args.out}")
    else:
        print("--- text ---")
        print(cleaned)
    return 0


if __name__ == "__main__":
    sys.exit(main())
