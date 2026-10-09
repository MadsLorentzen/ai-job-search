"""Location eligibility: can a candidate residing in Kenya take this role?

This module deliberately does **not** trust `classify_remote`'s tier for the
eligibility decision. `classify_remote` evaluates global marketing phrases
("worldwide", "global", "anywhere") *before* it looks for a region restriction,
so a posting reading "Remote, work from anywhere in Europe" classifies as
``fully_remote_global``. Eligibility therefore re-reads the posting text and
gives an explicit region restriction precedence over a global phrase.

Two concepts are kept apart on purpose:

* :class:`~app.state.models.RemoteStatus` is a *fact about the posting* - how
  the work is arranged.
* :class:`EligibilityVerdict` is a *decision about the candidate* - whether
  they may take it.

Silence is unverified, not permission. An ambiguous posting resolves to
``unknown``; it is never silently accepted, and never confidently rejected
without a stated reason.

Eligibility policy
------------------
These decisions are deliberate. Changing one is a policy change, not a bug fix.

1. An explicit positive mention of Kenya in a remote posting makes the role
   eligible, even when another region is listed alongside it - an employer who
   writes "Kenya" has made a positive statement. However, an explicit
   non-Kenyan ``location`` field outranks a passing mention in the job body:
   "Kenya market knowledge" is not an offer to Kenyan applicants.
2. APAC-only and EMEA-only postings resolve to ``unknown``, not to
   ``eligible`` or ``not_eligible``, unless Kenya is explicitly included or
   excluded. Kenya is inside EMEA but not inside APAC; neither is a clean
   exclusion, and guessing either way would be a confident wrong answer.
3. A missing salary never rejects a job. It produces a review flag.
4. An unknown work arrangement never silently rejects a job when remote work
   is preferred. It produces a review flag.
5. Every ``not_eligible`` verdict carries at least one human-readable reason,
   plus evidence quotes whenever the decision came from posting text.

Pure and deterministic: no I/O, no model calls, no new dependencies.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

from app.jobs.models import Job


ELIGIBLE = "eligible"
NOT_ELIGIBLE = "not_eligible"
UNKNOWN = "unknown"

_FLAGS = re.IGNORECASE

# Regions and countries that clearly exclude a candidate resident in Kenya.
# Matched against the posting text, so they also catch roles that carry no
# `country` field at all.
_EXCLUDING_TERMS = (
    # Regions
    r"\beu\b", r"\beurope\b", r"\beuropean\b", r"\bwestern europe\b",
    r"\bdach\b", r"\bbenelux\b", r"\bnordic", r"\bscandinavia\b",
    r"\bbasean\b", r"\bmena\b", r"\bgcc\b",
    r"\bnorth america\b", r"\bsouth america\b", r"\blatin america\b",
    r"\blatam\b", r"\bcentral america\b", r"\bamericas\b", r"\bcamerica\b",
    # Countries and territories outside Kenya
    r"\buk\b", r"\bunited kingdom\b", r"\bengland\b", r"\bscotland\b",
    r"\bwales\b", r"\bnorthern ireland\b", r"\bireland\b",
    r"\busa\b", r"\bu\.s\.\b", r"\bunited states\b", r"\bamerica\b",
    r"\bcanada\b", r"\bmexico\b", r"\bbrazil\b", r"\bargentina\b",
    r"\baustralia\b", r"\bnew zealand\b", r"\banz\b",
    r"\bindia\b", r"\bsingapore\b", r"\bjapan\b", r"\bchina\b",
    r"\buae\b", r"\bdubai\b", r"\babudhabi\b", r"\bqatar\b", r"\bsaudi\b",
    r"\bdenmark\b", r"\bnorway\b", r"\bsweden\b", r"\bfinland\b",
    r"\bpoland\b", r"\bportugal\b", r"\bspain\b", r"\bfrance\b",
    r"\bgermany\b", r"\bitaly\b", r"\baustria\b", r"\bswitzerland\b",
    r"\bbelgium\b", r"\bhungary\b", r"\bromania\b", r"\bgreece\b",
    r"\bczech\b", r"\bslovakia\b", r"\bslovenia\b", r"\bcroatia\b",
    r"\bestonia\b", r"\blatvia\b", r"\blithuania\b", r"\bluxembourg\b",
    r"\bmalta\b", r"\bcyprus\b", r"\bserbia\b", r"\bbulgaria\b",
    r"\bvietnam\b", r"\bthailand\b", r"\bmalaysia\b", r"\bindonesia\b",
    r"\bphilippines\b", r"\bpakistan\b", r"\bbangladesh\b",
    r"\bsouth africa\b", r"\begypt\b", r"\bmorocco\b", r"\btunisia\b",
)
_EXCLUDING_RE = re.compile("|".join(_EXCLUDING_TERMS), _FLAGS)

# Regions whose relationship to Kenya is genuinely ambiguous from the posting
# alone. "EMEA" contains Kenya; "APAC" does not. Neither is a clean exclusion,
# so these resolve to `unknown` rather than to a confident answer either way.
_AMBIGUOUS_REGION_RE = re.compile(r"\bemea\b|\bapac\b", _FLAGS)

# Phrases that genuinely mean "no geographic restriction".
_GLOBAL_RE = re.compile(
    r"\bworldwide\b|\bglobally\b|\bglobal\b|\banywhere\b|\binternational\b"
    r"|\bany location\b|\bany country\b|\bno location (?:restriction|limit)s?\b"
    r"|\bfully remote\b|\bremote[- ]first\b",
    _FLAGS,
)

# Phrases placing Kenya, or a region containing it, explicitly in scope.
_KENYA_IN_SCOPE_RE = re.compile(
    r"\bkenya\b|\bkenyan\b|\bnairobi\b|\bmombasa\b|\bafrica\b|\bafrican\b|\beast africa\b",
    _FLAGS,
)

_ON_SITE_WORK_RE = re.compile(
    r"\bon[- ]?site\b|\bin[- ]?office\b|\bhybrid\b|\bpartly remote\b"
    r"|\bpartially remote\b|\b\d+\s*days? (?:on|in)[- ]site\b|\bdesk[- ]bound\b",
    _FLAGS,
)

# ISO-3166 alpha-2/alpha-3 plus common English names, limited to what is needed
# to answer "is this the candidate's country?".
_COUNTRY_ALIASES = {
    "ke": "KE", "ken": "KE", "kenya": "KE",
    "dk": "DK", "dnk": "DK", "denmark": "DK",
    "gb": "GB", "uk": "GB", "united kingdom": "GB", "england": "GB",
    "us": "US", "usa": "US", "united states": "US",
    "de": "DE", "germany": "DE",
    "nl": "NL", "netherlands": "NL", "holland": "NL",
    "fr": "FR", "france": "FR",
    "es": "ES", "spain": "ES",
    "it": "IT", "italy": "IT",
    "se": "SE", "sweden": "SE",
    "no": "NO", "norway": "NO",
    "fi": "FI", "finland": "FI",
    "pl": "PL", "poland": "PL",
    "ie": "IE", "ireland": "IE",
    "za": "ZA", "south africa": "ZA",
    "ng": "NG", "nigeria": "NG",
    "in": "IN", "india": "IN",
    "ca": "CA", "canada": "CA",
    "au": "AU", "australia": "AU",
    "ae": "AE", "uae": "AE",
}

_MAX_QUOTES = 4
_MAX_QUOTE_LEN = 90


def _quote(text: str, match: re.Match) -> str:
    """Return a short, readable excerpt of the posting text behind a decision."""
    start, end = match.start(), match.end()
    left = max(0, start - 30)
    right = min(len(text), end + 30)
    excerpt = " ".join(text[left:right].split())
    if left > 0:
        excerpt = "..." + excerpt
    if right < len(text):
        excerpt = excerpt + "..."
    return excerpt[:_MAX_QUOTE_LEN]


def _find_all(pattern: re.Pattern, text: str, quotes: List[str]) -> List[str]:
    """Collect matched terms, recording a bounded number of supporting quotes."""
    found: List[str] = []
    for match in pattern.finditer(text):
        term = match.group(0).strip()
        if term and term not in found:
            found.append(term)
        if len(quotes) < _MAX_QUOTES:
            quote = _quote(text, match)
            if quote not in quotes:
                quotes.append(quote)
    return found


def _candidate_code(candidate_country: str) -> str:
    raw = candidate_country.strip()
    return _COUNTRY_ALIASES.get(raw.casefold(), raw.upper())


def _posting_country(job: Job) -> Optional[str]:
    raw = (job.country or "").strip().casefold()
    return _COUNTRY_ALIASES.get(raw) if raw else None


@dataclass
class EligibilityVerdict:
    """Whether a candidate may take a role, with the reason and the evidence.

    ``verdict`` is one of :data:`ELIGIBLE`, :data:`NOT_ELIGIBLE` or
    :data:`UNKNOWN`. ``reasons`` is non-empty for every ``not_eligible`` and
    every ``unknown`` result. ``evidence_quotes`` holds excerpts of the posting
    text that support the decision, so it can be shown to the user rather than
    merely asserted.
    """

    verdict: str
    reasons: List[str] = field(default_factory=list)
    evidence_quotes: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)

    @property
    def is_eligible(self) -> bool:
        return self.verdict == ELIGIBLE

    @property
    def is_unknown(self) -> bool:
        return self.verdict == UNKNOWN


def evaluate_eligibility(job: Job, *, candidate_country: str = "KE") -> EligibilityVerdict:
    """Decide whether a candidate resident in ``candidate_country`` may take ``job``.

    Precedence, in order:

    1. An explicit region or country restriction in the posting text wins over
       any global marketing phrase.
    2. Kenya, or a region containing Kenya, named explicitly -> eligible.
    3. A ``country`` field naming somewhere else -> not eligible.
    4. On-site and hybrid roles are decided by location, not by remote wording.
    5. A global phrase with no conflicting restriction -> eligible, with a note.
    6. Anything the posting does not state -> ``unknown``.
    """
    candidate = _candidate_code(candidate_country)
    parts = [part for part in (job.location, job.description) if part]
    text = " ".join(parts)
    quotes: List[str] = []

    kenya_terms = _find_all(_KENYA_IN_SCOPE_RE, text, quotes)
    kenya_named = bool(kenya_terms)
    kenya_in_location = bool(_KENYA_IN_SCOPE_RE.search(job.location or ""))

    # --- 1. a `country` field naming somewhere else is authoritative ---
    posting_country = _posting_country(job)
    if posting_country and posting_country != candidate:
        return EligibilityVerdict(
            verdict=NOT_ELIGIBLE,
            reasons=[
                f"role is located in {posting_country}, not {candidate}; a "
                f"{candidate_country}-based applicant is not eligible"
            ],
            evidence_quotes=quotes or ([f"country: {job.country}"] if job.country else []),
        )
    if posting_country == candidate:
        return EligibilityVerdict(
            verdict=ELIGIBLE,
            reasons=[f"role is located in {candidate}, matching the candidate's country"],
            evidence_quotes=quotes or ([f"country: {job.country}"]),
        )

    # --- 2. a location field anchored to another country outranks a passing
    #        mention of Kenya elsewhere in the posting text ("Kenya market
    #        knowledge" is not an offer to Kenyan applicants) ---
    location_terms = _find_all(_EXCLUDING_RE, job.location or "", [])
    if location_terms and not kenya_in_location:
        location_quotes: List[str] = []
        _find_all(_EXCLUDING_RE, job.location or "", location_quotes)
        return EligibilityVerdict(
            verdict=NOT_ELIGIBLE,
            reasons=[
                f"role is anchored to {', '.join(location_terms[:3])}, which excludes a "
                f"{candidate_country}-based applicant"
            ],
            evidence_quotes=quotes + location_quotes,
        )

    # --- 3. Kenya named explicitly is a positive statement by the employer and
    #        outranks inference, including co-listed locations ---
    if kenya_named:
        co_listed = _find_all(_EXCLUDING_RE, text, [])
        note = f"posting names Kenya ({', '.join(kenya_terms[:2])})"
        if co_listed:
            note += f" alongside {', '.join(co_listed[:2])}"
        return EligibilityVerdict(
            verdict=ELIGIBLE,
            reasons=["Kenya is explicitly in scope for this role"],
            evidence_quotes=quotes,
            notes=[note],
        )

    # --- 4. explicit exclusion elsewhere in the posting text ---
    excluding_terms = _find_all(_EXCLUDING_RE, text, quotes)
    if excluding_terms:
        return EligibilityVerdict(
            verdict=NOT_ELIGIBLE,
            reasons=[
                f"remote work is restricted to {', '.join(excluding_terms[:3])}, "
                f"which excludes a {candidate_country}-based applicant"
            ],
            evidence_quotes=quotes,
        )

    # --- 5. on-site / hybrid roles are decided by location ---
    if _ON_SITE_WORK_RE.search(text):
        if (job.location or "").strip():
            return EligibilityVerdict(
                verdict=NOT_ELIGIBLE,
                reasons=[
                    f"role requires on-site or hybrid presence in {job.location}, "
                    "which a Kenya-based applicant cannot commute to"
                ],
                evidence_quotes=quotes,
            )
        return EligibilityVerdict(
            verdict=UNKNOWN,
            reasons=["role is on-site or hybrid but the posting states no location"],
            evidence_quotes=quotes,
        )

    # --- 6. ambiguous region scoping ---
    ambiguous_terms = _find_all(_AMBIGUOUS_REGION_RE, text, quotes)
    if ambiguous_terms:
        return EligibilityVerdict(
            verdict=UNKNOWN,
            reasons=[
                f"posting scopes the role to {', '.join(ambiguous_terms[:2])} without stating "
                f"whether a {candidate_country}-based applicant is eligible"
            ],
            evidence_quotes=quotes,
            notes=["confirm with the employer whether Kenya-based applicants are considered"],
        )

    # --- 7. genuinely global ---
    global_terms = _find_all(_GLOBAL_RE, text, quotes)
    if global_terms:
        note = f"remote eligibility appears worldwide ({', '.join(global_terms[:2])})"
        if job.location:
            note += f", alongside the stated location {job.location!r}"
        return EligibilityVerdict(
            verdict=ELIGIBLE,
            reasons=["posting states no geographic restriction"],
            evidence_quotes=quotes,
            notes=[
                note + "; worldwide remote roles still require that Kenya-based "
                "applicants are eligible"
            ],
        )

    # --- 8. the posting does not say ---
    return EligibilityVerdict(
        verdict=UNKNOWN,
        reasons=["posting states no location, country or work-arrangement information"],
        evidence_quotes=quotes,
    )
