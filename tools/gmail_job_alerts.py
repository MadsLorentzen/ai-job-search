#!/usr/bin/env python3
"""Ingest LinkedIn Job Alert emails into the existing scrape -> rank pipeline.

LinkedIn Job Alert digests are a discovery source the portal CLIs cannot see:
each digest carries several real postings, and the ones that matter here are
remote AI/ML/data roles that never surfaced in a saved search. LinkedIn has no
candidate-side API for this and automating the signed-in site is off limits
(account risk, ToS), so the alert email is the only sanctioned read - the
mailbox the user already consented to, through a read-only scope.

This tool does the deterministic half of `/gmail-jobs`: validate the message,
pick the body part, parse every card in the digest, canonicalize links,
deduplicate against the state and the application tracker, and write new
entries into the SAME `job_scraper/seen_jobs.json` the scraper already uses -
never a parallel queue. Ranking and `/apply` stay where they are; this only
feeds them.

Design decisions that are load-bearing, not incidental:

* **`linkedin:<job_id>` is the dedup identity, the canonical seen_jobs key is
  `tools/job_key.py`'s.** Both matter. The job id is the only handle that is
  stable across two alerts carrying different tracking URLs, so it drives
  dedup and is stored as `source_key`. The file entry itself keeps the
  company+title key `/scrape`, `/rank` and `/apply` already agree on - a
  colon-bearing key would read as malformed to `tools/job_key.py --audit` and
  would break the archive-folder derivation that shares the same pair.

* **Only `/jobs/view/<id>/` URLs are recognized.** Everything else in an alert
  body - "see all jobs", manage-alert, help, unsubscribe - is dropped rather
  than stored, and a URL is never followed. Recipient tokens (`midToken`,
  `midSig`, `otpToken`, `eid`, `trackingId`, `refId`, ...) never reach the state
  file or the log, because the stored URL is rebuilt from the job id alone.

* **The body is data.** Only title, company, location and job id are extracted;
  no other text from the email survives into the output, so instruction-like
  text in a subject, a body, or a job title cannot be acted on downstream.

* **Identity is checked before parsing.** Sender must be the LinkedIn alert
  address; when LinkedIn's own headers are present they must match the
  allowlist, so a forwarded or spoofed look-alike is refused instead of parsed.

Usage:
  # offline, against captured fixtures
  python3 tools/gmail_job_alerts.py --messages-file tests/fixtures/alerts.json
  # live, read-only Gmail REST (credentials come from the environment only)
  python3 tools/gmail_job_alerts.py --fetch --since 24h

Exit 0 on a successful run (including "nothing new"), 1 on a configuration or
input error.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import csv
import hashlib
import json
import math
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from job_key import make_key  # noqa: E402  (sibling tool, resolved by path above)

ROOT = TOOLS_DIR.parent

# --- message identity -------------------------------------------------------

ALERT_SENDER = "jobalerts-noreply@linkedin.com"
ALLOWED_LINKEDIN_CLASSES = {"SAVEDSEARCH", "JOB_ALERT", "JOBALERT", "JOBS_YOU_MAY_BE_INTERESTED_IN"}
ALLOWED_LINKEDIN_TEMPLATE_PREFIXES = ("email_job_alert", "email_alert")

# Hosts a stored URL may point at. `linkedin.com` and its www form only: a
# look-alike (`linkedin.com.evil.example`), a userinfo trick
# (`www.linkedin.com@evil.example`) and LinkedIn's own shortener all resolve to
# a different hostname and are rejected, because the canonical URL is rebuilt
# from the id rather than kept as given.
ALLOWED_LINKEDIN_HOSTS = {"linkedin.com", "www.linkedin.com"}
# `/comm/jobs/view/<id>/` is the form the alert email itself links to (the
# `comm` segment is LinkedIn's email-tracking path prefix); the plain
# `/jobs/view/<id>/` is what a browser URL looks like. Both are the same
# posting, and both are rewritten to the plain canonical form.
JOB_PATH = re.compile(r"^/(?:comm/)?jobs/view/(?P<id>\d{6,})/?$")
URL_TOKEN = re.compile(r"https?://[^\s<>()\"']+", re.IGNORECASE)

# Recipient-specific parameters that must never be persisted or logged. The
# canonical URL is rebuilt from the id, so these never survive; the list is
# kept to assert that on any URL this module does return.
TRACKING_PARAMS = (
    "midtoken", "midsig", "otptoken", "eid", "trackingid", "refid", "trk",
    "trkemail", "lipi", "licu", "source", "veh",
)

# --- card parsing -----------------------------------------------------------

# The alert uses a middle dot (or a bullet / pipe / spaced dash) between the
# employer and the location in every locale LinkedIn ships.
SEPARATORS = (" \u00b7 ", "\u00b7", " \u2022 ", "\u2022", " \u2014 ", " \u2013 ", " | ")

# Lines that are chrome, not a job card. Matched against a normalized form
# (lowercased, punctuation and accents folded) so locale variants line up.
NOISE_PHRASES = {
    "see all jobs", "view all jobs", "see more jobs", "browse all jobs", "show all jobs",
    "manage alerts", "manage job alerts", "manage your alerts", "update your alerts",
    "manage preferences", "email preferences", "notification settings",
    "unsubscribe", "unsubscribe from this email", "help", "help center",
    "privacy policy", "terms of service", "terms", "linkedin corporation",
    "view job", "view jobs", "view job posting", "view posting", "apply", "apply now",
    "easy apply", "save", "save job", "saved",
    # The link label a card puts in front of its own URL ("View job: <url>").
    # Stripped of the URL, these are the only words on the line; anything else
    # that shares a line with a link keeps its text.
    "view the job", "view this job", "see job", "ver vaga", "ver a vaga", "ver empleo",
    "ver el empleo", "ver la vacante",
    "ver todas as vagas", "ver mais vagas", "ver todas as vagas de emprego",
    "gerenciar alertas", "gerenciar meus alertas", "cancelar inscricao",
    "cancelar assinatura", "ajuda", "politica de privacidade",
    "ver todos los empleos", "ver mas empleos", "gestionar alertas",
    "administrar alertas", "cancelar suscripcion", "ayuda", "politica de privacidad",
}

NOISE_PREFIXES = (
    "view job", "see all", "ver todas", "ver todos", "gerenciar", "gestionar",
    "unsubscribe", "cancelar", "your job alert", "job alert for",
    "new jobs match", "new jobs for", "top job picks", "jobs you may be interested",
    "seu alerta", "alerta de vagas", "novas vagas", "tu alerta", "nuevos empleos",
    "you are receiving", "this email was", "follow ", "recommended for you",
    "\u00a9", "update your", "manage your",
)

# A card that says it is dead. Mirrors /scrape's closed-at-source rule: the
# entry is stored with `status: expired` and never presented, because an absent
# entry is indistinguishable from a job never seen.
EXPIRED_MARKERS = (
    "no longer accepting applications", "no longer available", "no longer accepting",
    "position has been filled", "this job is closed", "applications are closed",
    "vaga encerrada", "vaga fechada", "nao esta mais aceitando",
    "ya no acepta solicitudes", "ya no esta disponible", "vacante cerrada",
)


def _fold(text: str) -> str:
    """Lowercase ASCII form for comparing chrome lines across locales."""
    decomposed = unicodedata.normalize("NFKD", str(text or ""))
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9 ]+", " ", ascii_only.lower()).strip()


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", _fold(text)).strip()


def is_noise_line(line: str) -> bool:
    """True for alert chrome - headers, footers, manage/unsubscribe links.

    A line whose only content besides a link is a link label ("View job: <url>")
    is chrome: the URL is the card's identity and the label is not text about
    the job, so keeping it would push the title line out of the card window.
    """
    stripped = line.strip()
    if not stripped:
        return True
    if URL_TOKEN.fullmatch(stripped):
        return True
    residue = URL_TOKEN.sub("", stripped).strip(" :-\u2013\u2014\u00b7")
    if not residue:
        return True
    folded = _fold(stripped)
    label = _squash(residue)
    if label in NOISE_PHRASES or _squash(stripped) in NOISE_PHRASES:
        return True
    return any(folded.startswith(prefix) for prefix in NOISE_PREFIXES)


def clean_lines(text: str) -> list[str]:
    """The usable card lines in a chunk of alert text, in order."""
    lines = [line.strip() for line in text.splitlines()]
    return [line for line in lines if not is_noise_line(line)]


def split_company_location(line: str) -> tuple[str, str | None]:
    """`Acme Corp · Brazil (Remote)` -> ("Acme Corp", "Brazil (Remote)")."""
    for sep in SEPARATORS:
        if sep in line:
            company, _, location = line.partition(sep)
            return company.strip(), (location.strip() or None)
    return line.strip(), None


def canonical_linkedin_url(url: str) -> str | None:
    """The canonical `https://www.linkedin.com/jobs/view/<id>/`, or None.

    Any other host, scheme, or path - a search page, a company page, an
    unsubscribe link, a look-alike domain - is not a posting and is refused.
    Rebuilding the URL from the id is what drops the recipient tokens: nothing
    of the original query string survives.
    """
    if not isinstance(url, str) or not url.strip():
        return None
    candidate = url.strip().strip("<>").rstrip(".,;:)]\"'")
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None
    if parsed.scheme.lower() not in ("http", "https"):
        return None
    if (parsed.hostname or "").lower() not in ALLOWED_LINKEDIN_HOSTS:
        return None
    match = JOB_PATH.match(parsed.path)
    if not match:
        return None
    return f"https://www.linkedin.com/jobs/view/{match.group('id')}/"


def linkedin_job_id(url: str) -> str | None:
    canonical = canonical_linkedin_url(url)
    if canonical is None:
        return None
    match = JOB_PATH.match(urlsplit(canonical).path)
    return match.group("id") if match else None


def strip_tracking_params(url: str) -> str:
    """The tracking-free form of a LinkedIn URL, or "" if it is not one.

    For a recognized posting this is the canonical URL, so the recipient
    tokens are gone by construction. For any other LinkedIn URL the known
    parameter names are dropped from the query string rather than passed
    through, so the function never hands back a URL that still carries
    `midToken`/`otpToken`/`eid`. Only the canonical form is ever stored.
    """
    canonical = canonical_linkedin_url(url)
    if canonical is not None:
        return canonical
    if not isinstance(url, str) or not url.strip():
        return ""
    try:
        parsed = urlsplit(url.strip())
    except ValueError:
        return ""
    if (parsed.hostname or "").lower() not in ALLOWED_LINKEDIN_HOSTS:
        return ""
    kept = [
        pair for pair in parsed.query.split("&")
        if pair and pair.split("=", 1)[0].lower() not in TRACKING_PARAMS
    ]
    from urllib.parse import urlunsplit

    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "&".join(kept), ""))


def dedup_key(job_id: str | None, company: str, title: str, location: str | None) -> str:
    """Stable identity for one posting, independent of its tracking URL.

    `linkedin:<id>` when the alert carried an id - two digests announcing the
    same job with different `trackingId`s are one job. Otherwise a hash of the
    normalized posting, because a digest that lost its link still must not be
    ingested twice under two keys.
    """
    if job_id:
        return f"linkedin:{job_id}"
    basis = "|".join(_squash(part) for part in (company, title, location or ""))
    digest = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]
    return f"alert:{digest}"


@dataclass
class ParsedJob:
    title: str
    company: str
    location: str | None
    url: str
    job_id: str | None
    source_key: str
    expired: bool = False

    def as_entry(self, *, status: str, message_id: str, discovered_at: str,
                 eligibility: str, eligibility_note: str) -> dict:
        """The seen_jobs.json entry: scraper schema + Gmail alert provenance.

        No raw body, no subject, no tracking URL, no recipient address - the
        four extracted fields plus ids. Everything else about the message stays
        in the mailbox where it belongs.
        """
        return {
            "title": self.title,
            "company": self.company,
            "location": self.location,
            "url": self.url,
            "first_seen": discovered_at[:10],
            "posted_date": None,
            "deadline": None,
            "fit": None,
            "status": status,
            "portal": "linkedin_email_alert",
            "source": "gmail",
            "source_type": "gmail_alert",
            "linkedin_job_id": self.job_id,
            "source_key": self.source_key,
            "source_email_id": message_id,
            "discovered_at": discovered_at,
            "eligibility": eligibility,
            "eligibility_note": eligibility_note,
        }


def parse_alert_text(text: str) -> tuple[list[ParsedJob], list[dict]]:
    """Every job card in one alert body, plus the cards that could not be read.

    Tolerant by region, strict by card. A blank line separates cards in the
    plain-text part, so each region is scanned for recognized posting URLs and
    the text between two URLs belongs to the first of them - which is what
    makes a multi-job digest parse as N jobs instead of one. Within a card the
    two shapes LinkedIn actually emits are accepted:

        Title
        Company · Location
        View job: <url>

        Title
        Company
        Location
        <url>

    Anything else is reported as malformed rather than guessed at: a wrong
    title or company is worse than a missing entry, because both feed the
    dedup key and the archive folder name.
    """
    jobs: list[ParsedJob] = []
    malformed: list[dict] = []
    if not text:
        return jobs, malformed

    for region in re.split(r"\n\s*\n", text):
        if not region.strip():
            continue
        tokens = []
        for match in URL_TOKEN.finditer(region):
            canonical = canonical_linkedin_url(match.group(0))
            if canonical:
                tokens.append((match.start(), match.end(), canonical))
        if not tokens:
            continue

        pieces: list[str] = []
        cursor = 0
        for start, end, _canonical in tokens:
            pieces.append(region[cursor:start])
            cursor = end
        pieces.append(region[cursor:])

        for index, (_start, _end, canonical) in enumerate(tokens):
            before, after = pieces[index], pieces[index + 1]
            before_lines, after_lines = clean_lines(before), clean_lines(after)
            # The card sits immediately above its own link, so the side with
            # more usable lines wins; ties go to the text before the URL.
            if len(before_lines) >= len(after_lines) and before_lines:
                lines = before_lines
            else:
                lines = after_lines
            # The closed-at-source marker trails the link in the digest
            # ("... View job: <url>\nNo longer accepting applications"), so the
            # expiry scan reads the whole neighbourhood of the card, not just
            # the side the title/company came from.
            parsed = _card_from_lines(lines[-4:], canonical, before + "\n" + after)
            if parsed is None:
                malformed.append({
                    "url": canonical,
                    "reason": "card did not match a known title/company/location shape",
                })
                continue
            jobs.append(parsed)
    return jobs, malformed


def _card_from_lines(lines: list[str], canonical: str, card_text: str) -> ParsedJob | None:
    """One card from its last few lines, or None when the shape is unknown."""
    if len(lines) >= 2 and split_company_location(lines[-1])[1]:
        company, location = split_company_location(lines[-1])
        title = lines[-2]
    elif len(lines) >= 3:
        title = lines[-3]
        company = lines[-2]
        location = lines[-1].strip() or None
    else:
        return None
    title, company = title.strip(), company.strip()
    if not title or not company:
        return None
    job_id = linkedin_job_id(canonical)
    folded_card = _fold(card_text)
    expired = any(marker in folded_card for marker in EXPIRED_MARKERS)
    return ParsedJob(
        title=title,
        company=company,
        location=location,
        url=canonical,
        job_id=job_id,
        source_key=dedup_key(job_id, company, title, location),
        expired=expired,
    )


# --- message decoding -------------------------------------------------------


def header_map(message: dict) -> dict[str, str]:
    headers: dict[str, str] = {}
    payload = message.get("payload") or {}
    for header in payload.get("headers") or []:
        name = str(header.get("name", "")).lower()
        if name and name not in headers:
            headers[name] = str(header.get("value", ""))
    return headers


def _decode_part(part: dict) -> str:
    data = ((part.get("body") or {}).get("data")) or ""
    if not data:
        return ""
    padded = data + "=" * (-len(data) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
    except (binascii.Error, ValueError, UnicodeEncodeError):
        return ""
    return raw.decode("utf-8", errors="replace")


def _iter_parts(payload: dict):
    yield payload
    for part in payload.get("parts") or []:
        yield from _iter_parts(part)


def html_to_text(html: str) -> str:
    """Text projection of an HTML body that keeps anchors as their own lines.

    An anchor becomes "<href>\\n<label>", so the same region/card parser used
    for the plain-text part sees the URL and the title it belongs to. That is
    what keeps HTML a fallback rather than a second parser with its own bugs.
    """
    if not html:
        return ""
    body = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", html)
    body = re.sub(
        r'(?is)<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
        lambda m: f"\n{unescape(re.sub(r'<[^>]+>', ' ', m.group(2))).strip()}\n{unescape(m.group(1))}\n",
        body,
    )
    body = re.sub(r"(?i)<br\s*/?>", "\n", body)
    body = re.sub(r"(?i)</(p|div|li|tr|td|h[1-6]|table)>", "\n", body)
    body = re.sub(r"<[^>]+>", " ", body)
    body = unescape(body)
    lines = [re.sub(r"[ \t\u00a0]+", " ", line).strip() for line in body.splitlines()]
    return "\n".join(line for line in lines if line)


def message_body(message: dict) -> tuple[str, str]:
    """(text, part-kind) preferring text/plain, falling back to text/html.

    Mail clients disagree about which part is authoritative, but the plain-text
    part of this digest repeats title/company/location above each link with no
    markup in the way, so it is the primary read and HTML is the safety net.
    """
    payload = message.get("payload") or {}
    plain, html = "", ""
    for part in _iter_parts(payload):
        mime = str(part.get("mimeType", "")).lower()
        if mime == "text/plain" and not plain:
            plain = _decode_part(part)
        elif mime == "text/html" and not html:
            html = _decode_part(part)
    if plain.strip():
        return plain, "text/plain"
    return html_to_text(html), "text/html"


def is_linkedin_job_alert(message: dict) -> tuple[bool, str]:
    """Identity check. Returns (accepted, reason-or-warning).

    The sender is required. LinkedIn's own headers, when present, must match
    the allowlist - an `X-LinkedIn-Class` of anything else means this is not
    the saved-search digest it claims to be. Their absence is tolerated (a
    redirect through a mail gateway drops them) but reported, so the run says
    which messages were accepted on sender alone.
    """
    headers = header_map(message)
    sender = headers.get("from", "")
    if ALERT_SENDER not in sender.lower():
        return False, f"sender is not {ALERT_SENDER}"
    klass = headers.get("x-linkedin-class", "").strip()
    template = headers.get("x-linkedin-template", "").strip()
    if klass and klass.upper() not in ALLOWED_LINKEDIN_CLASSES:
        return False, f"unexpected X-LinkedIn-Class: {klass}"
    if template and not template.lower().startswith(ALLOWED_LINKEDIN_TEMPLATE_PREFIXES):
        return False, f"unexpected X-LinkedIn-Template: {template}"
    if not klass and not template:
        return True, "accepted on sender alone (LinkedIn identity headers absent)"
    return True, ""


def message_timestamp(message: dict, fallback: datetime) -> datetime:
    internal = str(message.get("internalDate") or "")
    if internal.isdigit():
        return datetime.fromtimestamp(int(internal) / 1000, tz=timezone.utc)
    return fallback


# --- eligibility (the fork's Remote Brazil gate, at ingestion depth) --------


BRAZIL_TERMS = ("brazil", "brasil", "sao paulo", "rio de janeiro", "belo horizonte",
                "porto alegre", "curitiba", "recife", "fortaleza", "brasilia")
LATAM_TERMS = ("latam", "latin america", "south america", "america latina", "america do sul")
WORLDWIDE_TERMS = ("worldwide", "anywhere", "global", "globally", "any location")

# Named scopes that exclude Brazil. A posting scoped to one of these is a FAIL
# per the fork policy ("explicit Brazil exclusion"), not a flag to argue with.
EXCLUSION_TERMS = (
    "united states", "usa", "u s a", "u s only", "us only", "canada", "united kingdom",
    " uk ", "germany", "france", "spain only", "portugal only", "india", "ireland",
    "poland", "netherlands", "singapore", "australia", "japan", "china", "emea only",
    "europe only", "eu only", "apac only", "north america only",
)


def location_eligibility(location: str | None, title: str = "") -> tuple[str, str]:
    """PASS / FLAG / FAIL for the location half of the Remote Brazil policy.

    Deliberately shallow: an alert card's location line is one short string, so
    this only vetoes the cases the policy vetoes by name (an explicit
    non-Brazil scope) and flags everything else. Salary, work authorization,
    language and role fit need the posting itself - that is `/rank`'s job, and
    duplicating a half-strength version of it here would produce a second,
    weaker gate that disagrees with the real one.
    """
    if not (location or "").strip():
        return "FLAG", "location not stated in the alert - confirm scope before drafting"
    haystack = f" {_fold(f'{location} {title}')} "
    if any(term in haystack for term in EXCLUSION_TERMS) and not any(
        term in haystack for term in BRAZIL_TERMS + LATAM_TERMS + WORLDWIDE_TERMS
    ):
        return "FAIL", f"scope excludes Brazil: {location.strip()!r}"
    if any(term in haystack for term in BRAZIL_TERMS + LATAM_TERMS + WORLDWIDE_TERMS):
        return "PASS", f"scope covers Brazil/LATAM/worldwide: {location.strip()!r}"
    return "FLAG", f"scope not explicitly Brazil-compatible: {location.strip()!r}"


# --- state ------------------------------------------------------------------


class ConfigError(RuntimeError):
    """A run that cannot proceed without user-supplied configuration."""


def load_seen(path: Path) -> tuple[dict, dict]:
    """(document, seen mapping). A missing file starts as `{"seen": {}}`.

    Tolerant of the legacy bare-object shape the job-key helper also accepts,
    so an old state file is read rather than overwritten.
    """
    if not path.exists():
        return {"seen": {}}, {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"cannot read {path}: {exc}") from exc
    if not isinstance(doc, dict):
        raise ConfigError(f"{path}: expected a JSON object")
    seen = doc.get("seen", doc)
    if not isinstance(seen, dict):
        raise ConfigError(f"{path}: expected `seen` to be an object")
    return doc, seen


def seen_index(seen: dict) -> tuple[set[str], set[str], set[str]]:
    """(canonical urls, linkedin job ids, source keys) already stored.

    Three indexes because the same posting can be present from an earlier
    `/scrape` run (keyed by company+title, no job id) or from an earlier alert
    (keyed by job id, tracking URL since dropped).
    """
    urls, ids, keys = set(), set(), set()
    for entry in seen.values():
        if not isinstance(entry, dict):
            continue
        url = canonical_linkedin_url(str(entry.get("url") or ""))
        if url:
            urls.add(url)
        job_id = entry.get("linkedin_job_id")
        if job_id:
            ids.add(str(job_id))
        key = entry.get("source_key")
        if key:
            keys.add(str(key))
    return urls, ids, keys


def tracker_pairs(path: Path) -> set[tuple[str, str]]:
    if not path.exists():
        return set()
    pairs = set()
    try:
        with path.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                company = _squash(row.get("company") or "")
                role = _squash(row.get("role") or "")
                if company:
                    pairs.add((company, role))
    except (OSError, csv.Error, UnicodeDecodeError):
        return set()
    return pairs


@dataclass
class Report:
    messages_total: int = 0
    messages_rejected: list[dict] = field(default_factory=list)
    messages_skipped: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    ingested: list[dict] = field(default_factory=list)
    duplicates: list[dict] = field(default_factory=list)
    already_tracked: list[dict] = field(default_factory=list)
    ineligible: list[dict] = field(default_factory=list)
    expired: list[dict] = field(default_factory=list)
    malformed: list[dict] = field(default_factory=list)
    written: bool = False
    state_path: str | None = None

    def as_dict(self) -> dict:
        return {
            "messages_total": self.messages_total,
            "messages_rejected": self.messages_rejected,
            "messages_skipped": self.messages_skipped,
            "warnings": self.warnings,
            "ingested": self.ingested,
            "duplicates": self.duplicates,
            "already_tracked": self.already_tracked,
            "ineligible": self.ineligible,
            "expired": self.expired,
            "malformed": self.malformed,
            "written": self.written,
            "state_path": self.state_path,
        }


def ingest_messages(
    messages: list[dict],
    *,
    seen_path: Path,
    tracker_path: Path,
    state_path: Path | None = None,
    now: datetime | None = None,
    write: bool = True,
    reprocess: bool = False,
) -> Report:
    """Parse alerts, gate them, and (unless dry-run) write the new entries."""
    now = now or datetime.now(timezone.utc)
    report = Report()
    doc, seen = load_seen(seen_path)
    urls, ids, source_keys = seen_index(seen)
    tracked = tracker_pairs(tracker_path)

    processed: list[str] = []
    if state_path and state_path.exists():
        try:
            state_doc = json.loads(state_path.read_text(encoding="utf-8"))
            processed = [str(m) for m in state_doc.get("processed_message_ids") or []]
        except (OSError, json.JSONDecodeError):
            report.warnings.append(f"{state_path} unreadable; treating every message as new")
    processed_ids = set(processed)
    report.state_path = str(state_path) if state_path else None

    for message in messages:
        report.messages_total += 1
        message_id = str(message.get("id") or "")
        if message_id and message_id in processed_ids and not reprocess:
            report.messages_skipped.append({"message_id": message_id, "reason": "already processed"})
            continue

        accepted, reason = is_linkedin_job_alert(message)
        if not accepted:
            report.messages_rejected.append({"message_id": message_id, "reason": reason})
            if message_id:
                processed.append(message_id)
            continue
        if reason:
            report.warnings.append(f"{message_id}: {reason}")

        body, part = message_body(message)
        jobs, malformed = parse_alert_text(body)
        discovered_at = message_timestamp(message, now).isoformat().replace("+00:00", "Z")
        if message_id:
            processed.append(message_id)
        for item in malformed:
            report.malformed.append({**item, "message_id": message_id})

        for job in jobs:
            record = {
                "title": job.title,
                "company": job.company,
                "location": job.location,
                "url": job.url,
                "linkedin_job_id": job.job_id,
                "source_key": job.source_key,
                "message_id": message_id,
                "part": part,
            }
            if job.url in urls or (job.job_id and job.job_id in ids) or job.source_key in source_keys:
                report.duplicates.append({**record, "reason": "already in seen_jobs.json"})
                continue
            if (_squash(job.company), _squash(job.title)) in tracked:
                _store(seen, urls, ids, source_keys, job, status="skipped",
                       message_id=message_id, discovered_at=discovered_at,
                       eligibility=location_eligibility(job.location, job.title)[0],
                       eligibility_note="already recorded in job_search_tracker.csv")
                report.already_tracked.append(record)
                continue

            verdict, note = location_eligibility(job.location, job.title)
            if job.expired:
                _store(seen, urls, ids, source_keys, job, status="expired",
                       message_id=message_id, discovered_at=discovered_at,
                       eligibility=verdict,
                       eligibility_note="alert marks the posting as closed")
                report.expired.append({**record, "eligibility": verdict})
                continue
            if verdict == "FAIL":
                _store(seen, urls, ids, source_keys, job, status="skipped",
                       message_id=message_id, discovered_at=discovered_at,
                       eligibility=verdict, eligibility_note=note)
                report.ineligible.append({**record, "eligibility": verdict, "note": note})
                continue

            _store(seen, urls, ids, source_keys, job, status="new",
                   message_id=message_id, discovered_at=discovered_at,
                   eligibility=verdict, eligibility_note=note)
            report.ingested.append({**record, "eligibility": verdict, "eligibility_note": note})

    if write:
        seen_path.parent.mkdir(parents=True, exist_ok=True)
        payload = doc if isinstance(doc.get("seen"), dict) else {"seen": seen}
        payload["seen"] = seen
        seen_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        report.written = True
        if state_path:
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(
                json.dumps({
                    "last_sync": now.date().isoformat(),
                    "processed_message_ids": list(dict.fromkeys(processed)),
                }, indent=2) + "\n",
                encoding="utf-8",
            )
    return report


def _store(seen: dict, urls: set, ids: set, source_keys: set, job: ParsedJob, *,
           status: str, message_id: str, discovered_at: str,
           eligibility: str, eligibility_note: str) -> None:
    """Insert one entry under the canonical company+title key.

    Never overwrite an existing entry: it may already carry `/rank` fields
    (`rank_score`, `strengths`, `gaps`) this tool knows nothing about, and the
    dedup indexes are checked before this is ever reached. When the key exists
    the provenance we now know is merged in instead.
    """
    entry = job.as_entry(
        status=status, message_id=message_id, discovered_at=discovered_at,
        eligibility=eligibility, eligibility_note=eligibility_note,
    )
    key = make_key(job.company, job.title, job.url)
    existing = seen.get(key)
    if isinstance(existing, dict):
        for field_name, value in (
            ("linkedin_job_id", job.job_id),
            ("source_key", job.source_key),
            ("source_type", "gmail_alert"),
            ("location", job.location),
        ):
            if value is not None:
                existing.setdefault(field_name, value)
        return
    seen[key] = entry
    urls.add(entry["url"])
    if entry.get("linkedin_job_id"):
        ids.add(str(entry["linkedin_job_id"]))
    source_keys.add(entry["source_key"])


# --- Gmail REST (read-only) -------------------------------------------------

GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me"
CREDENTIAL_ENV = ("GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN")


def build_query(since: str | None = None, extra: str | None = None) -> str:
    """The Gmail search string for alert messages.

    Sender-scoped by default: the alert address is the only sender whose
    digests are parsed, and scoping server-side keeps unrelated mail out of the
    run entirely. A window is expressed with the operator that matches the
    input - `newer_than:` for a relative window, `after:` for a date, because
    `newer_than:2026/09/01` is silently ignored by Gmail and a silently ignored
    bound is a full-mailbox scan.
    """
    parts = [f"from:{ALERT_SENDER}"]
    if since:
        value = parse_since(since)
        parts.append(f"after:{value}" if re.fullmatch(r"\d{4}/\d{2}/\d{2}", value)
                     else f"newer_than:{value}")
    if extra:
        parts.append(extra)
    return " ".join(parts)


def parse_since(since: str) -> str:
    """`24h` / `7d` / `30d` -> Gmail's day-based window; a date passes through.

    Gmail's `newer_than:` accepts `d`/`m`/`y` only, so hours are rounded up to
    a whole day rather than passed through as `24h`, which Gmail silently
    ignores - and a silently ignored bound is a full-mailbox scan.
    """
    match = re.fullmatch(r"\s*(\d+)\s*([hdw])\s*", since or "")
    if match:
        value, unit = int(match.group(1)), match.group(2)
        if unit == "h":
            return f"{max(1, math.ceil(value / 24))}d"
        return f"{value}{'w' if unit == 'w' else 'd'}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", since or ""):
        year, month, day = since.split("-")
        return f"{year}/{month}/{day}"  # Gmail's after: form
    if re.fullmatch(r"\d+[dmy]", since or ""):
        return since
    raise ConfigError(f"unrecognized --since value: {since!r} (use 24h, 7d, 30d or YYYY-MM-DD)")


def _default_transport(method: str, url: str, token: str, data: bytes | None = None,
                       timeout: int = 30) -> dict:
    request = Request(url, data=data, method=method)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise ConfigError(f"Gmail API {exc.code} for {url.split('?')[0]}") from exc
    except URLError as exc:
        raise ConfigError(f"Gmail API unreachable: {exc.reason}") from exc


def fetch_access_token(env: dict | None = None, transport=None) -> str:
    """Exchange a stored refresh token for an access token, in memory only.

    Credentials are read from the environment, never from a file inside the
    repository: the repo is the thing that gets shared, so a token path under
    it is a token that leaks. Nothing here is written back to disk.
    """
    env = {name: os.environ.get(name, "") for name in CREDENTIAL_ENV} if env is None else env
    missing = [name for name in CREDENTIAL_ENV if not env.get(name)]
    if missing:
        raise ConfigError(
            "missing Gmail OAuth configuration: " + ", ".join(missing)
            + ". Export them in the shell that runs this tool "
              "(read-only scope https://www.googleapis.com/auth/gmail.readonly); "
              "never commit them to the repository."
        )
    body = (
        f"client_id={env['GMAIL_CLIENT_ID']}&client_secret={env['GMAIL_CLIENT_SECRET']}"
        f"&refresh_token={env['GMAIL_REFRESH_TOKEN']}&grant_type=refresh_token"
    ).encode("ascii")
    transport = transport or _default_transport
    payload = transport("POST", GMAIL_TOKEN_URL, "", body)
    token = payload.get("access_token")
    if not token:
        raise ConfigError("Gmail OAuth token exchange returned no access_token")
    return str(token)


def fetch_alert_messages(query: str, *, token: str, max_results: int = 50,
                         transport=None) -> list[dict]:
    """List matching messages and fetch each in `format=full`.

    Paginated by `pageToken` and capped by `max_results`: a backfill of a year
    of alerts is thousands of messages, and an unbounded crawl of someone's
    mailbox is not a thing a job-queue tool should do by accident.
    """
    transport = transport or _default_transport
    ids: list[str] = []
    page_token = None
    while len(ids) < max_results:
        url = (
            f"{GMAIL_API_ROOT}/messages?q={quote(query, safe='')}"
            f"&maxResults={min(100, max_results - len(ids))}"
        )
        if page_token:
            url += f"&pageToken={quote(page_token, safe='')}"
        listing = transport("GET", url, token)
        for item in listing.get("messages") or []:
            if isinstance(item, dict) and item.get("id"):
                ids.append(str(item["id"]))
        page_token = listing.get("nextPageToken")
        if not page_token:
            break
    return [
        transport("GET", f"{GMAIL_API_ROOT}/messages/{message_id}?format=full", token)
        for message_id in ids[:max_results]
    ]


def _encode_part(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii")


def expand_fixture(message: dict) -> dict:
    """Readable fixture form -> Gmail API shape.

    `tests/fixtures/linkedin_job_alerts.json` keeps its bodies as plain text
    (`body_text` / `body_html`) so the file reviews like the mail it stands in
    for. Real Gmail API messages pass through untouched, so both forms feed the
    same code path and a fixture run exercises the real parser.
    """
    if not isinstance(message, dict) or "payload" in message:
        return message
    text, html = message.get("body_text"), message.get("body_html")
    if text is None and html is None:
        return message
    headers = [{"name": str(k), "value": str(v)} for k, v in (message.get("headers") or {}).items()]
    parts = []
    if text is not None:
        parts.append({"mimeType": "text/plain", "body": {"data": _encode_part(text)}})
    if html is not None:
        parts.append({"mimeType": "text/html", "body": {"data": _encode_part(html)}})
    payload: dict = {"headers": headers, "mimeType": parts[0]["mimeType"] if len(parts) == 1 else "multipart/alternative"}
    if len(parts) == 1:
        payload["body"] = parts[0]["body"]
    else:
        payload["parts"] = parts
    return {
        "id": message.get("id", ""),
        "threadId": message.get("threadId", message.get("id", "")),
        "internalDate": str(message.get("internalDate", "")),
        "payload": payload,
    }


def load_messages_file(path: Path) -> list[dict]:
    """Fixture input: `{"messages": [...]}` or a bare list of messages."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"cannot read {path}: {exc}") from exc
    messages = doc.get("messages") if isinstance(doc, dict) else doc
    if not isinstance(messages, list):
        raise ConfigError(f"{path}: expected a list of Gmail messages (or {{\"messages\": [...]}})")
    return [expand_fixture(m) for m in messages if isinstance(m, dict)]


# --- reporting --------------------------------------------------------------


def render_report(report: Report) -> str:
    lines: list[str] = []
    lines.append("## Gmail Job Alerts - Ingestion")
    lines.append("")
    lines.append(
        f"Scanned {report.messages_total} message(s): "
        f"{len(report.ingested)} new job(s), {len(report.duplicates)} duplicate(s), "
        f"{len(report.already_tracked)} already tracked, {len(report.ineligible)} gated out, "
        f"{len(report.expired)} expired, {len(report.malformed)} unreadable card(s)."
    )
    if report.ingested:
        lines.append("")
        lines.append("| # | Title | Company | Location | Scope | URL |")
        lines.append("|---|---|---|---|---|---|")
        for index, job in enumerate(report.ingested, 1):
            lines.append(
                f"| {index} | {job['title']} | {job['company']} | {job['location'] or ''} "
                f"| {job['eligibility']} | [{job['url']}]({job['url']}) |"
            )
    for label, rows in (
        ("Duplicates (already in seen_jobs.json)", report.duplicates),
        ("Already tracked", report.already_tracked),
        ("Gated out (eligibility FAIL)", report.ineligible),
        ("Expired at source", report.expired),
        ("Unreadable cards", report.malformed),
        ("Rejected messages", report.messages_rejected),
        ("Skipped messages", report.messages_skipped),
    ):
        if rows:
            lines.append("")
            lines.append(f"### {label}")
            for row in rows:
                detail = row.get("reason") or row.get("note") or row.get("eligibility") or ""
                lines.append(
                    f"- {row.get('title') or row.get('message_id') or row.get('url', '')}"
                    + (f" - {detail}" if detail else "")
                )
    if report.warnings:
        lines.append("")
        lines.append("### Notes")
        for warning in report.warnings:
            lines.append(f"- {warning}")
    if report.state_path:
        lines.append("")
        lines.append(f"_State: {report.state_path} - written: {report.written}_")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--messages-file", type=Path,
                        help="Gmail message JSON fixtures (offline run)")
    parser.add_argument("--fetch", action="store_true",
                        help="read live messages through the read-only Gmail REST API")
    parser.add_argument("--query", help="override the Gmail search query")
    parser.add_argument("--since", help="lookback window: 24h, 7d, 30d or YYYY-MM-DD")
    parser.add_argument("--max", type=int, default=50, help="cap on messages fetched (default 50)")
    parser.add_argument("--seen", type=Path, default=ROOT / "job_scraper" / "seen_jobs.json")
    parser.add_argument("--tracker", type=Path, default=ROOT / "job_search_tracker.csv")
    parser.add_argument("--state", type=Path,
                        default=ROOT / "gmail_sync" / "gmail_jobs_state.json",
                        help="processed-message-id state (lives with the other personal Gmail state)")
    parser.add_argument("--dry-run", action="store_true", help="report only; write nothing")
    parser.add_argument("--reprocess", action="store_true",
                        help="re-parse messages already marked processed")
    parser.add_argument("--json", action="store_true", help="machine-readable report")
    args = parser.parse_args(argv)

    try:
        if args.messages_file:
            messages = load_messages_file(args.messages_file)
        elif args.fetch:
            query = args.query or build_query(args.since)
            token = fetch_access_token()
            messages = fetch_alert_messages(query, token=token, max_results=max(1, args.max))
        else:
            parser.error("give --messages-file (offline) or --fetch (live Gmail)")

        report = ingest_messages(
            messages,
            seen_path=args.seen,
            tracker_path=args.tracker,
            state_path=args.state,
            write=not args.dry_run,
            reprocess=args.reprocess,
        )
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(report.as_dict(), indent=2, ensure_ascii=False))
    else:
        print(render_report(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
