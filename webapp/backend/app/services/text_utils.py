"""Small text-parsing helpers shared between the resume-master seed script
and the evaluation rubric config loader. Both parse loosely-structured
markdown prose into keyword lists and both hit the same two failure modes:
splitting on a comma that's nested inside parentheses, and substring
matching that false-positives on short tokens.
"""

from __future__ import annotations

import re


def split_respecting_parens(text: str, seps: str = ",;") -> list[str]:
    """Split on top-level separators only -- a ',' inside "(Brazil, broader
    Latin America)" or "(campaigns, systems, teams)" must not split the term,
    or the parenthetical's contents leak out as their own garbage fragments.
    """
    parts, buf, depth = [], [], 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch in seps and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    return parts


def contains_phrase(haystack: str, phrase: str) -> bool:
    """Word-boundary containment check. Naive `phrase in haystack` substring
    matching produces false positives for short tokens -- "Git" matches
    inside "digital", "R" matches inside nearly everything.
    """
    return re.search(rf"\b{re.escape(phrase.lower())}\b", haystack.lower()) is not None


def contains_any_phrase(haystack: str, phrases: list[str]) -> bool:
    return any(contains_phrase(haystack, phrase) for phrase in phrases)


def humanize_list(items: list[str]) -> str:
    """['A/B testing', 'HubSpot', 'Salesforce'] -> 'A/B testing, HubSpot, and Salesforce'."""
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])}, and {items[-1]}"
