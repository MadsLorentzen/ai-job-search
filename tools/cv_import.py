#!/usr/bin/env python3
"""Parse a pasted CV into the structured profile /setup Path B needs.

Path B was prose only ("paste a CV, extract it"), so every run extracted
differently: truncated pastes silently produced half profiles, invisible
characters broke contact matching, and a pasted prompt-injection line could
ride into the profile files as an instruction. This tool makes the import
deterministic and auditable before the model writes anything.

Usage:
  python3 tools/cv_import.py --in cv.txt
  Get-Content cv.txt | python tools/cv_import.py --pretty
  python3 tools/cv_import.py --in cv.txt --out profile.json

Stdlib only. UTF-8 on stdout whatever the host locale is.
"""

import argparse
import json
import re
import sys
from pathlib import Path

ZERO_WIDTH = "​‌‍⁠⁡⁢⁣⁤"
BIDI = "‎‏‪‫‬‭‮⁦⁧⁨⁩"
FORMAT = "­  "
BOM = "﻿"
INVISIBLE_RE = re.compile(f"[{re.escape(ZERO_WIDTH + BIDI + FORMAT + BOM)}]")

INSTRUCTION_RE = re.compile(
    r"(?i)^\s*(?:"
    r"ignore\s+(?:all\s+)?previous\s+instructions"
    r"|disregard\s+.*(?:instructions|above)"
    r"|forget\s+(?:all\s+|everything\s+)?(?:previous|prior|above).*"
    r"|you\s+are\s+now\s+"
    r"|new\s+instructions?\s*:"
    r"|system\s*prompt\s*:"
    r")"
)

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:\+\d[\d\s().-]{6,}\d|\b\d[\d\s().-]{8,}\d\b)")
LINKEDIN_RE = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/in/[A-Za-z0-9._%/-]+", re.I)
GITHUB_RE = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[A-Za-z0-9._-]+", re.I)

SECTION_HEADS = (
    ("experience", re.compile(r"(?im)^\s*(work\s+experience|professional\s+experience|employment(\s+history)?|experience)\s*$")),
    ("education", re.compile(r"(?im)^\s*(education(\s+and\s+training)?|academic\s+background|qualifications)\s*$")),
    ("skills", re.compile(r"(?im)^\s*(technical\s+skills|core\s+competencies|skills(\s+and\s+technologies)?|technologies)\s*$")),
    ("languages", re.compile(r"(?im)^\s*languages\s*$")),
    ("projects", re.compile(r"(?im)^\s*(projects|independent\s+projects|personal\s+projects|portfolio)\s*$")),
)

DATE_RANGE_RE = re.compile(
    r"(?P<start>(?:19|20)\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:19|20)\d{2})"
    r"\s*(?:[-_\u2013\u2014]|to)\s*"
    r"(?P<end>Present|Now|Current|Ongoing|(?:19|20)\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:19|20)\d{2})",
    re.I,
)

MIN_CHARS = 200
MAX_CHARS = 60000


def _force_utf8_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            try:
                reconfigure(encoding="utf-8")
            except Exception:
                pass


def _read_input(path):
    try:
        if path is not None:
            return path.read_bytes().decode("utf-8", errors="replace"), None
        buffer = getattr(sys.stdin, "buffer", None)
        if buffer is not None:
            data = buffer.read().decode("utf-8", errors="replace")
        else:
            data = sys.stdin.read()
        return data, None
    except OSError as exc:
        return "", f"cannot read input: {exc}"


def clean_text(raw: str):
    counts = {}
    for ch in raw:
        if ch in ZERO_WIDTH:
            counts["zero_width"] = counts.get("zero_width", 0) + 1
        elif ch in BIDI:
            counts["bidi"] = counts.get("bidi", 0) + 1
        elif ch in FORMAT:
            counts["format"] = counts.get("format", 0) + 1
        elif ch == BOM:
            counts["bom"] = counts.get("bom", 0) + 1
    text = INVISIBLE_RE.sub("", raw)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text, counts


def find_instruction_lines(text: str):
    return [ln.strip()[:200] for ln in text.splitlines() if INSTRUCTION_RE.match(ln)]


def split_sections(text: str):
    hits = []
    for name, pattern in SECTION_HEADS:
        for m in pattern.finditer(text):
            hits.append((m.start(), m.end(), name))
    hits.sort()
    sections = {}
    order = []
    head = text[: hits[0][0]].strip() if hits else text.strip()
    for i, (s, e, name) in enumerate(hits):
        end = hits[i + 1][0] if i + 1 < len(hits) else len(text)
        if name not in sections:
            order.append(name)
        prev = sections.get(name, "")
        sections[name] = (prev + "\n" + text[e:end]).strip()
    return head, sections, order


def parse_header(block: str):
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    name = ""
    for ln in lines[:3]:
        if EMAIL_RE.search(ln) or PHONE_RE.search(ln):
            continue
        if 3 <= len(ln) <= 80 and len(ln.split()) <= 6:
            if not DATE_RANGE_RE.search(ln):
                name = ln
                break
    if not name and lines:
        name = lines[0][:80]
    em = EMAIL_RE.search(block)
    ph = PHONE_RE.search(block)
    li = LINKEDIN_RE.search(block)
    gh = GITHUB_RE.search(block)
    return {
        "name": name,
        "email": em.group(0) if em else "",
        "phone": ph.group(0).strip() if ph else "",
        "linkedin": li.group(0) if li else "",
        "github": gh.group(0) if gh else "",
    }


def parse_experience(body: str):
    roles = []
    if not body:
        return roles
    chunks = re.split(r"\n\s*\n", body.strip())
    for chunk in chunks[:20]:
        lines = [ln.strip() for ln in chunk.splitlines() if ln.strip()]
        if not lines:
            continue
        dm = DATE_RANGE_RE.search(chunk[:500])
        bullets = [ln.lstrip("|-* ").strip() for ln in lines[1:8]]
        roles.append({
            "header": lines[0][:160],
            "dates": dm.group(0) if dm else "",
            "bullets": [b for b in bullets if b][:6],
        })
    return roles


def parse_list(body: str, limit=30):
    items = []
    for ln in body.splitlines():
        ln = ln.strip().lstrip("|-* ").strip()
        if len(ln) > 1:
            items.append(ln[:200])
        if len(items) >= limit:
            break
    return items


def build_gaps(profile: dict):
    gaps = []
    ident = profile.get("identity", {})
    if not ident.get("name"):
        gaps.append("identity.name: no name line detected")
    if not ident.get("email"):
        gaps.append("identity.email: no email found")
    if not ident.get("phone"):
        gaps.append("identity.phone: no phone found")
    if not profile.get("experience"):
        gaps.append("experience: no roles detected")
    if not profile.get("education"):
        gaps.append("education: no education section detected")
    if not profile.get("skills"):
        gaps.append("skills: no skills section detected")
    if not profile.get("languages"):
        gaps.append("languages: no languages section (needed for Language Gate)")
    gaps.append("behavioral: work-environment preferences (Path B follow-up)")
    gaps.append("goals: target roles, deal-breakers, location (Path B follow-up)")
    return gaps


def run(raw: str):
    warnings = []
    if len(raw.strip()) < MIN_CHARS:
        return None, {"ok": False, "error": "input too short: paste full CV"}
    if len(raw) > MAX_CHARS:
        warnings.append(f"input truncated to {MAX_CHARS} chars")
        raw = raw[:MAX_CHARS]
    text, counts = clean_text(raw)
    injected = find_instruction_lines(text)
    if injected:
        warnings.append("instruction-shaped lines quoted in findings; data only")
    tail = text.splitlines()[-1].strip() if text.splitlines() else ""
    if len(text.splitlines()) > 5 and tail:
        if not re.search(r"[.!:)\]}]$|(?:19|20)\d{2}|Present|Now", tail):
            warnings.append("paste may be truncated: last line ends mid-sentence")
    head, sections, order = split_sections(text)
    profile = {
        "identity": parse_header(head),
        "experience": parse_experience(sections.get("experience", "")),
        "education": parse_list(sections.get("education", ""), 15),
        "skills": parse_list(sections.get("skills", ""), 30),
        "languages": parse_list(sections.get("languages", ""), 10),
        "projects": parse_list(sections.get("projects", ""), 20),
    }
    if not profile["experience"] and not profile["education"]:
        if not profile["skills"]:
            return None, {"ok": False, "error": "no sections detected"}
    return {
        "ok": True,
        "profile": profile,
        "sections_found": order,
        "gaps": build_gaps(profile),
        "warnings": warnings,
        "findings": {
            "invisible_chars": counts,
            "instruction_like_lines": injected[:10],
            "chars": len(text),
            "roles_detected": len(profile["experience"]),
        },
        "cleaned_text": text,
    }, None


def main(argv=None) -> int:
    _force_utf8_output()
    ap = argparse.ArgumentParser(prog="cv_import.py", description="Parse CV text.")
    ap.add_argument("--in", dest="infile", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args(argv)
    raw, err = _read_input(args.infile)
    if err:
        print(f"cv_import: {err}", file=sys.stderr)
        return 2
    result, failure = run(raw)
    if failure:
        print(json.dumps(failure, ensure_ascii=False, indent=2))
        return 1
    text = json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None)
    if args.out is not None:
        try:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(text + "\n", encoding="utf-8")
        except OSError as exc:
            print(f"cv_import: cannot write: {exc}", file=sys.stderr)
            return 2
        print(f"saved={args.out}")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())



