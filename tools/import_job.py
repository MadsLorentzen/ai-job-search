#!/usr/bin/env python3
"""Import a user-copied Chinese job posting without accessing the portal.

The importer deliberately accepts only a posting URL and a local text file.
It never reads browser state, credentials, or remote content. The source text
is archived byte-for-byte before any best-effort field extraction happens.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse, urlunparse


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STATE = ROOT / "job_scraper" / "seen_jobs.json"
DEFAULT_ARCHIVE = ROOT / "documents" / "postings"
PORTAL_DOMAINS = {
    "boss-search": ("zhipin.com", "kanzhun.com"),
    "51job-search": ("51job.com", "51jobcdn.com", "51job.com.cn"),
}


class ImportErrorValue(ValueError):
    """Raised for user-correctable import input errors."""


def normalize_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise ImportErrorValue("--url must be an absolute http(s) URL")
    host = parsed.hostname.lower() if parsed.hostname else ""
    if not host:
        raise ImportErrorValue("--url must include a hostname")
    # Fragments point to a listing anchor, not a stable posting detail.
    if parsed.fragment:
        raise ImportErrorValue("--url must not contain a #fragment; provide the detail-page URL")
    return urlunparse(("https", host, parsed.path.rstrip("/"), "", parsed.query, ""))


def infer_portal(url: str, requested: str) -> str:
    if requested != "auto":
        domains = PORTAL_DOMAINS[requested]
        host = urlparse(url).hostname or ""
        if not any(host == domain or host.endswith("." + domain) for domain in domains):
            raise ImportErrorValue(f"URL host does not match --portal {requested}")
        return requested
    host = urlparse(url).hostname or ""
    for portal, domains in PORTAL_DOMAINS.items():
        if any(host == domain or host.endswith("." + domain) for domain in domains):
            return portal
    raise ImportErrorValue("cannot infer portal from URL; use --portal boss-search or --portal 51job-search")


def is_detail_url(url: str, portal: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.lower()
    if portal == "boss-search":
        return bool(re.search(r"/(job_detail|jobdetail|geek/job)/", path)) or bool(re.search(r"/job/[a-z0-9]+", path))
    query = {key.casefold(): value for key, value in parse_qs(parsed.query).items()}
    if query.get("jobid") and any(item.strip() for item in query["jobid"]):
        return True
    if re.search(r"/(?:job_detail|jobdetail|jobinfo)(?:[/.]|$)", path):
        return True
    return bool(re.search(r"/\d+\.html?$", path)) and not any(token in path for token in ("/list", "/index", "/zhaopin"))


def read_source(path: Path) -> tuple[bytes, str]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ImportErrorValue(f"could not read --text-file {path}: {exc}") from exc
    if not raw.strip():
        raise ImportErrorValue("--text-file is empty")
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return raw, raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw, raw.decode("utf-8", errors="replace")


def clean(value: str | None) -> str | None:
    if not value:
        return None
    result = re.sub(r"[ \t\u00a0]+", " ", value.replace("\r", "")).strip(" \t:：")
    return result or None


def labelled(text: str, labels: str) -> str | None:
    match = re.search(rf"(?:^|[\n|｜])\s*(?:{labels})\s*[:：]\s*([^\n|｜]+)", text, re.I)
    return clean(match.group(1)) if match else None


def extract_title(text: str) -> str | None:
    value = labelled(text, r"职位名称|职位|岗位名称|岗位|招聘职位|title")
    if value:
        return value
    for line in text.splitlines():
        candidate = clean(line)
        if candidate and 2 <= len(candidate) <= 80 and not re.search(
            r"(招聘|岗位职责|任职要求|薪资|公司地址|发布时间|职位描述|请在平台|点击|登录|暂不可见|查看详情)",
            candidate,
        ):
            return candidate
    return None


def extract_company(text: str) -> str | None:
    return labelled(text, r"公司名称|公司|企业名称|雇主|company")


def extract_location(text: str) -> str | None:
    return labelled(text, r"工作地点|职位地点|地点|城市|工作地址|location")


def extract_salary(text: str) -> str | None:
    value = labelled(text, r"薪资|薪酬|月薪|年薪|salary")
    if value:
        return value
    match = re.search(r"\d+(?:\.\d+)?\s*(?:-|至|~|～)\s*\d+(?:\.\d+)?\s*(?:万|千|K|k)?(?:/月|/年|元/月|元/年)?(?:\s*[·.]\s*\d+薪)?", text)
    return clean(match.group(0)) if match else None


def parse_salary(value: str | None) -> tuple[int | None, int | None, int | None, str]:
    if not value or re.search(r"面议|面谈|保密|不限", value, re.I):
        return None, None, None, "unknown"
    unit = "year" if re.search(r"年薪|/年|元/年", value) else "month"
    if re.search(r"/天|元/日", value):
        unit = "day"
    if re.search(r"/时|/小时", value):
        unit = "hour"
    numbers = re.findall(r"\d+(?:\.\d+)?", value)
    if not numbers:
        return None, None, None, unit

    def scale(number: str) -> int:
        amount = float(number)
        if "万" in value:
            amount *= 10000
        elif re.search(r"千|[Kk]", value):
            amount *= 1000
        return int(amount)

    amounts = [scale(number) for number in numbers[:2]]
    months = int(numbers[-1]) if re.search(r"薪", value) and len(numbers) >= 3 else None
    return amounts[0], amounts[-1], months, unit


def parse_date(value: str | None, today: date | None = None) -> str | None:
    if not value:
        return None
    today = today or date.today()
    if re.search(r"今天|刚刚", value):
        return today.isoformat()
    if re.search(r"昨天", value):
        return (today - timedelta(days=1)).isoformat()
    relative = re.search(r"(\d+)\s*天前", value)
    if relative:
        return (today - timedelta(days=int(relative.group(1)))).isoformat()
    match = re.search(r"(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})", value)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3))).isoformat()
    except ValueError:
        return None


def extract_fields(text: str) -> dict[str, object]:
    title = extract_title(text)
    company = extract_company(text)
    location = extract_location(text)
    salary = extract_salary(text)
    salary_min, salary_max, salary_months, salary_unit = parse_salary(salary)
    experience = labelled(text, r"经验要求|工作经验|经验|experience")
    education = labelled(text, r"学历要求|学历|education")
    posted = labelled(text, r"发布时间|发布日期|更新日期|date")
    return {
        "title": title,
        "company": company,
        "location": location,
        "salary": salary,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_months": salary_months,
        "salary_unit": salary_unit,
        "experience": experience,
        "education": education,
        "posted_date": parse_date(posted),
    }


def safe_name(value: str, fallback: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")
    value = re.sub(r"\s+", " ", value)
    return (value[:100] or fallback)


def load_state(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"seen": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ImportErrorValue(f"could not read state file {path}: {exc}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("seen", {}), dict):
        raise ImportErrorValue(f"state file {path} must contain an object with a 'seen' object")
    return payload


def find_existing(seen: dict[str, object], url: str) -> str | None:
    for key, value in seen.items():
        if not isinstance(value, dict):
            continue
        candidate_url = str(value.get("url", "")).strip()
        if candidate_url:
            try:
                if normalize_url(candidate_url) == url:
                    return key
            except ImportErrorValue:
                continue
    return None


def raw_id_from(url: str, portal: str) -> str | None:
    parsed = urlparse(url)
    query = {key.casefold(): value for key, value in parse_qs(parsed.query).items()}
    if query.get("jobid"):
        return clean(query["jobid"][0])
    tail = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    tail = re.sub(r"\.html?$", "", tail, flags=re.I)
    if portal == "boss-search" or tail.isdigit():
        return tail or None
    return None


def write_state(path: Path, state: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(payload)
        temporary = Path(handle.name)
    temporary.replace(path)


def import_job(args: argparse.Namespace) -> dict[str, object]:
    url = normalize_url(args.url)
    portal = infer_portal(url, args.portal)
    if not is_detail_url(url, portal):
        raise ImportErrorValue("--url must point to a job detail page, not a search/list page")
    source_path = Path(args.text_file).expanduser().resolve()
    raw, text = read_source(source_path)
    archive_dir = Path(args.archive_dir).expanduser().resolve()
    archive_dir.mkdir(parents=True, exist_ok=True)
    fallback_archive = archive_dir / f"manual-import-{hashlib.sha256(url.encode('utf-8')).hexdigest()[:16]}.txt"
    # Archive first so even a failed best-effort parse leaves the user's source
    # recoverable on disk. A later successful parse moves it to a descriptive name.
    fallback_archive.write_bytes(raw)
    fields = extract_fields(text)
    if not fields["title"] and not fields["company"]:
        raise ImportErrorValue(f"could not extract a title or company; original text archived at {fallback_archive}")

    state_path = Path(args.state_file).expanduser().resolve()
    state = load_state(state_path)
    seen = state["seen"]
    assert isinstance(seen, dict)
    existing_key = find_existing(seen, url)
    key = existing_key or ("portal:" + portal + "|url:" + url)
    existing = seen.get(key) if isinstance(seen.get(key), dict) else {}
    assert isinstance(existing, dict)
    company = str(fields["company"] or "unknown-company")
    title = str(fields["title"] or "untitled-job")
    stem = f"{safe_name(company, 'unknown-company')} - {safe_name(title, 'untitled-job')}"
    archive_path = archive_dir / f"{stem}.txt"
    if existing_key is None and archive_path.exists():
        archive_path = archive_dir / f"{stem} [{hashlib.sha256(url.encode('utf-8')).hexdigest()[:8]}].txt"
    archive_path.write_bytes(raw)
    if archive_path != fallback_archive:
        fallback_archive.unlink(missing_ok=True)
    record = {
        **existing,
        **fields,
        "id": hashlib.sha256(url.encode("utf-8")).hexdigest()[:16],
        "title": fields["title"] or title,
        "company": fields["company"],
        "url": url,
        "first_seen": existing.get("first_seen") or date.today().isoformat(),
        "deadline": existing.get("deadline"),
        "fit": existing.get("fit") or "low",
        "status": existing.get("status") or "new",
        "portal": portal,
        "source": "manual",
        "access_mode": "manual_import",
        "raw_id": raw_id_from(url, portal),
        "archive_path": str(archive_path.relative_to(ROOT)) if archive_path.is_relative_to(ROOT) else str(archive_path),
        "imported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    seen[key] = record
    write_state(state_path, state)
    return {"key": key, "created": existing_key is None, "record": record, "archive_path": str(archive_path), "state_file": str(state_path)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import a user-provided job posting without network access")
    parser.add_argument("--url", required=True, help="canonical BOSS or 51job detail URL")
    parser.add_argument("--text-file", required=True, help="local UTF-8/GB18030 file containing copied posting text")
    parser.add_argument("--portal", choices=("auto", *PORTAL_DOMAINS), default="auto")
    parser.add_argument("--state-file", default=str(DEFAULT_STATE))
    parser.add_argument("--archive-dir", default=str(DEFAULT_ARCHIVE))
    parser.add_argument("--format", choices=("json", "plain"), default="json")
    return parser


def main(argv: list[str] | None = None) -> int:
    # Windows commonly starts Python with a GBK console. Keep machine output
    # valid UTF-8 so Chinese records are never lost before reaching a pipe.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = import_job(args)
    except ImportErrorValue as exc:
        print(json.dumps({"error": str(exc), "code": "BAD_INPUT"}, ensure_ascii=False), file=sys.stderr)
        return 2
    if args.format == "plain":
        print(f"{result['record']['title']} | {result['record']['company']} | {result['record']['url']}")
        print(f"archive: {result['archive_path']}")
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
