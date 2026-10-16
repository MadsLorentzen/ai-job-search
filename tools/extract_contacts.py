#!/usr/bin/env python3
"""Pull recruiter/contact details out of job-posting text.

`/scrape` Step 2 already holds every shortlisted posting's full description, and
`/outreach` needs to know who to write to. A real batch of Dublin postings showed
the signal is there but mixed: about a third of them named a contact, and the
matches split three ways -

  * a named person ("contact Jane Doe at Example Group", "Jane Doe, Talent
    Acquisition Manager"), sometimes with a published address;
  * a recruiting inbox (recruiting@..., careers@..., hr@...);
  * addresses that are *not* outreach channels at all - accommodation requests,
    data-protection/privacy contacts, no-reply senders. Cold-emailing those is a
    misuse of an address published for another purpose, so they are dropped.

The tool only reads what the employer published in the posting. It never guesses
an address from a name (no firstname.lastname@ pattern inference) and never looks
anyone up - a name without a published address is returned without an email, and
`/outreach` turns that into a LinkedIn note instead.

Posting text is untrusted third-party data: the output is data for the caller to
weigh (with the evidence snippet), never an instruction.

Usage:
  python3 tools/extract_contacts.py --text-file posting.txt
  python3 tools/extract_contacts.py --json detail.json      # portal `detail` JSON
  cat posting.txt | python3 tools/extract_contacts.py

Prints {"contacts": [...]} as JSON. Each contact has name, email, role, kind
("named" | "recruiting_inbox" | "generic_inbox") and evidence. Exit 0 always on
readable input (an empty list is a valid answer); exit 2 on unreadable input.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")

# Addresses published for a purpose other than hiring conversations.
EXCLUDED_LOCAL = re.compile(
    r"accommodat|accessib|disabilit|adjustment|privacy|gdpr|dataprotection|data\.protection"
    r"|dpo|noreply|no-reply|donotreply|do-not-reply|unsubscribe|abuse|legal|fraud|scam"
    r"|security|compliance|press|media|invoice|billing|support|webmaster|postmaster",
    re.I,
)
EXCLUDED_CONTEXT = re.compile(
    r"accommodat|disabilit|reasonable adjustment|privacy|data protection|personal data"
    r"|gdpr|fraud|scam|phishing|unsubscribe|your data",
    re.I,
)
RECRUITING_LOCAL = re.compile(
    r"recruit|talent|career|jobs?|hiring|^hr$|^hr[._-]|[._-]hr$|people|resourcing|apply|vacanc",
    re.I,
)

NAME = r"[A-Z][a-z'’-]+(?: [A-Z][a-z'’-]+){1,2}"
ROLE = (
    r"(?:(?:Senior|Lead|Principal|Head of|Global|Technical|Graduate|Campus)\s+)*"
    r"(?:Talent Acquisition(?: (?:Manager|Partner|Specialist|Lead|Coordinator|Advisor))?"
    r"|Technical Recruiter|Recruiter|Recruitment (?:Consultant|Manager|Partner|Lead|Specialist)"
    r"|Recruiting (?:Manager|Partner|Lead)|Hiring Manager|HR (?:Manager|Business Partner|Partner)"
    r"|People Partner|Resourcing (?:Partner|Specialist|Manager))"
)
# "contact Jane Doe", "reach out to Jane Doe", "speak with Jane Doe"
LEAD_IN_RE = re.compile(
    r"(?i:contact|reach out to|speak (?:to|with)|get in touch with|email|call|message"
    r"|(?:enquiries|queries|questions)[^.:]{0,60}?(?:directed |sent |addressed )?to:?)\s+"
    r"(?:(?:Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s+)?(?P<name>" + NAME + r")"
)
# "Jane Doe, Talent Acquisition Manager" / "Jane Doe - Recruiter" / "Jane Doe (Recruiter)"
NAME_ROLE_RE = re.compile(r"(?P<name>" + NAME + r")\s*(?:,|-|–|—|\(|\|)\s*(?P<role>" + ROLE + r")")
# "Talent Acquisition Manager: Jane Doe" / "Recruiter - Jane Doe"
ROLE_NAME_RE = re.compile(r"(?P<role>" + ROLE + r")\s*(?::|-|–|—)\s*(?P<name>" + NAME + r")")

NOT_A_NAME = {
    "talent", "acquisition", "team", "human", "resources", "recruitment", "recruiting",
    "the", "our", "us", "hiring", "manager", "department", "group", "please", "data",
    "ireland", "dublin", "london", "cork", "galway", "company", "careers", "career",
    "people", "hr", "apply", "today", "now", "more", "information", "january", "february",
    "march", "april", "may", "june", "july", "august", "september", "october",
    "november", "december", "monday", "friday", "equal", "opportunity", "employer",
}


def snippet(text: str, start: int, end: int, pad: int = 60) -> str:
    s = text[max(0, start - pad): min(len(text), end + pad)]
    return re.sub(r"\s+", " ", s).strip()


def plausible_name(name: str) -> bool:
    parts = name.split()
    return 2 <= len(parts) <= 3 and not any(p.lower().strip("'’-") in NOT_A_NAME for p in parts)


def extract(text: str) -> list[dict]:
    contacts: list[dict] = []
    by_name: dict[str, dict] = {}

    def add_name(name: str, role: str | None, m: re.Match) -> None:
        name = name.strip()
        if not plausible_name(name):
            return
        key = name.lower()
        if key in by_name:
            if role and not by_name[key]["role"]:
                by_name[key]["role"] = role.strip()
            return
        c = {"name": name, "email": None, "role": role.strip() if role else None,
             "kind": "named", "evidence": snippet(text, m.start(), m.end())}
        by_name[key] = c
        contacts.append(c)

    for rx in (NAME_ROLE_RE, ROLE_NAME_RE, LEAD_IN_RE):
        for m in rx.finditer(text):
            add_name(m.group("name"), m.groupdict().get("role"), m)

    seen_emails: set[str] = set()
    for m in EMAIL_RE.finditer(text):
        email = m.group(0).rstrip(".").lower()
        if email in seen_emails:
            continue
        seen_emails.add(email)
        local = email.split("@", 1)[0]
        # Judge the whole sentence the address sits in: "If you require a reasonable
        # accommodation to complete an application, participate in an interview, or
        # take part in any other stage ..., please contact hr@..." puts the purpose
        # word 150 characters before the address.
        s_start = max(text.rfind(". ", 0, m.start()), text.rfind("\n", 0, m.start()), 0)
        nxt = [i for i in (text.find(". ", m.end()), text.find("\n", m.end())) if i != -1]
        context = text[max(s_start, m.start() - 400): min(nxt) if nxt else len(text)]
        if EXCLUDED_LOCAL.search(local) or EXCLUDED_CONTEXT.search(context):
            continue
        # Attach to a named contact when the local part carries their name.
        owner = None
        for c in contacts:
            if c["kind"] == "named" and c["email"] is None:
                tokens = [t.lower() for t in c["name"].split() if len(t) > 1]
                if any(t in local for t in tokens):
                    owner = c
                    break
        if owner:
            owner["email"] = email
            continue
        personal = re.fullmatch(r"([a-z]{2,})[._-]([a-z]{2,})", local)
        if RECRUITING_LOCAL.search(local):
            kind, name = "recruiting_inbox", None
        elif personal:
            # A published first.last@ address is a person's own inbox; reading the
            # name off it is not guessing - the address itself was published.
            kind, name = "named", " ".join(p.capitalize() for p in personal.groups())
        else:
            kind, name = "generic_inbox", None
        contacts.append({"name": name, "email": email, "role": None, "kind": kind,
                         "evidence": snippet(text, m.start(), m.end())})

    rank = {"named": 0, "recruiting_inbox": 1, "generic_inbox": 2}
    contacts.sort(key=lambda c: (rank[c["kind"]], c["email"] is None))
    return contacts


def read_input(args: argparse.Namespace) -> str:
    if args.json:
        with open(args.json, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and isinstance(data.get("result"), dict):
            data = data["result"]
        if not isinstance(data, dict):
            raise ValueError("JSON input must be an object with a 'description' field")
        return str(data.get("description") or "")
    if args.text_file:
        with open(args.text_file, encoding="utf-8") as fh:
            return fh.read()
    return sys.stdin.read()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--text-file", help="plain-text posting")
    src.add_argument("--json", help="portal detail JSON (uses its 'description')")
    args = ap.parse_args(argv)
    try:
        text = read_input(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps({"contacts": extract(text)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
