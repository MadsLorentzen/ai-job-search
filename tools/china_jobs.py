#!/usr/bin/env python3
"""国内社招辅助工具：生成搜索计划、解释薪资、导入用户提供的岗位正文。"""

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

try:
    from .job_key import make_key
    from .posting_guard import guard
    from .rank_state import save_state
except ImportError:
    from job_key import make_key
    from posting_guard import guard
    from rank_state import save_state

ROOT = Path(__file__).resolve().parent.parent
PORTALS = {
    "boss": ("BOSS直聘", "zhipin.com"),
    "liepin": ("猎聘", "liepin.com"),
    "zhaopin": ("智联招聘", "zhaopin.com"),
    "51job": ("前程无忧", "51job.com"),
}


def salary_info(raw: str) -> dict:
    """只换算明确标注的人民币金额；未标注发薪月数时不推断年薪。"""
    text = unicodedata.normalize("NFKC", raw).strip()
    text = text.replace(",", "").replace("，", "").replace("−", "-").replace("–", "-")
    result = {
        "raw": raw, "currency": "CNY", "period": None,
        "min": None, "max": None, "salary_months": None,
        "annual_min": None, "annual_max": None, "notes": [],
    }
    if re.search(r"USD|EUR|HKD|美元|美金|欧元|港币|港元|税后|到手", text, re.I):
        result["notes"].append("非人民币税前口径，请人工确认币种及税前税后，未换算。")
        result["currency"] = None
        return result
    if re.search(r"面议|保密|可谈", text):
        result["notes"].append("薪资未明确披露。")
        return result
    pattern = r"(?P<lo>\d+(?:\.\d+)?)\s*(?P<lu>[kKwW千万]?)\s*(?:[-~～至到]\s*(?P<hi>\d+(?:\.\d+)?)\s*)?(?P<hu>[kKwW千万]?)(?:元)?"
    # 从第一个金额开始完整匹配，拒绝将签字费、股权或招聘年限当作工资。
    match = re.match(pattern, text)
    if not match:
        result["notes"].append("无法识别薪资格式，请保留原文人工确认。")
        return result
    values = match.groupdict()
    lo_unit = values["lu"] or values["hu"]
    hi_unit = values["hu"] or values["lu"]
    rest = text[match.end():]
    annual = bool(re.search(r"/年|每年|年薪|万元/年|万/年", text))
    daily = bool(re.search(r"/天|/日|每天|每日", text))
    monthly = bool(re.search(r"/月|每月|月薪|薪", rest)) or lo_unit.lower() in ("k", "千")
    if sum((annual, daily)) > 1 or (not annual and not daily and not monthly):
        result["notes"].append("发薪周期不明确，不把裸金额或未标周期的万元报价当作月薪。")
        return result
    scale = {"": 1, "k": 1000, "千": 1000, "w": 10000, "万": 10000}
    lo = float(values["lo"]) * scale[lo_unit.lower()]
    hi = float(values["hi"] or values["lo"]) * scale[hi_unit.lower()]
    if lo <= 0 or hi < lo:
        raise ValueError("薪资区间必须为正数且下限不高于上限")
    suffix = re.sub(r"^(?:/月|每月|月薪|/年|每年|年薪|/天|/日|每天|每日)", "", rest.strip())
    months = re.fullmatch(r"[\s·•*x×]*([1-9]\d?)\s*薪", suffix)
    if suffix and not months:
        # 混合薪酬保留原文，避免把提成、期权、可变奖金计算为保证收入。
        result["notes"].append("包含额外或复合薪酬条件，未自动换算；请拆分底薪、奖金、提成和股权。")
        return result
    result.update(period="year" if annual else "day" if daily else "month", min=lo, max=hi)
    if annual:
        result.update(annual_min=lo, annual_max=hi)
    elif months and not daily:
        n = int(months.group(1))
        result.update(salary_months=n, annual_min=lo * n, annual_max=hi * n)
        result["notes"].append("按标注发薪月数计算的名义年薪，额外月薪是否保证发放仍需确认。")
    elif not daily:
        result["notes"].append("发薪月数未知，未推断年薪；12个月底薪仅可作为单独的比较口径。")
    if daily:
        result["notes"].append("日薪未折算成年薪，需确认出勤天数及用工形式。")
    return result


def search_plan(role: str, city: str, portals: list[str]) -> dict:
    """生成可供 WebSearch 使用的查询，结果不是已抓取的岗位。"""
    if not role.strip() or not city.strip():
        raise ValueError("请提供目标岗位和城市")
    return {
        "market": "CN", "track": "experienced", "role": role, "city": city,
        "queries": [
            {"portal": key, "name": PORTALS[key][0],
             "query": f'site:{PORTALS[key][1]} "{role}" "{city}" 招聘'}
            for key in portals
        ],
        "notes": ["仅生成搜索计划，不访问网络，不代表存在招聘 API 或已获取岗位正文。",
                  "摘要只作线索；正文需公开页面、企业招聘官网或用户粘贴材料验证。"],
    }


def import_posting(root: Path, raw: str, company: str, title: str,
                   location: str, url: str = "", salary: str = "", write: bool = False) -> dict:
    """把已清洗的岗位存入已有 rank 状态；不同岗位链接发生键冲突时拒绝覆盖。"""
    if not company.strip() or not title.strip() or not raw.strip():
        raise ValueError("公司、岗位名称和岗位正文不能为空")
    parsed = urlsplit(url) if url else None
    if parsed and (parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username):
        raise ValueError("来源 URL 必须是无用户凭据的 http(s) 地址")
    cleaned, findings = guard(raw, "auto")
    if not cleaned.strip():
        raise ValueError("清洗后没有可用岗位正文")
    key = make_key(company, title, url)
    state_path = root / "job_scraper/seen_jobs.json"
    if state_path.exists():
        doc = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict) or not isinstance(doc.get("seen"), dict):
            raise ValueError("seen_jobs.json 必须是包含 seen 对象的状态文件，未修改原文件")
    else:
        doc = {"seen": {}}
    old = doc["seen"].get(key)
    if old is not None and not isinstance(old, dict):
        raise ValueError("已有岗位状态格式错误，未修改原文件")
    old = old or {}
    if old.get("url") and url and old["url"].rstrip("/") != url.rstrip("/"):
        raise ValueError("相同公司和岗位名称对应不同链接，请在岗位名称中补充城市或职级后重新导入")
    posting_file = f"documents/postings/{key}.md"
    salary = salary or old.get("salary_raw", "")
    location = location or old.get("location", "")
    url = url or old.get("url", "")
    digest = hashlib.sha256(cleaned.encode("utf-8")).hexdigest()
    host = (urlsplit(url).hostname or "").lower() if url else ""
    portal = next((k for k, (_, h) in PORTALS.items() if host == h or host.endswith("." + h)), "manual")
    entry = dict(old)
    changed = old.get("posting_sha256") != digest or old.get("salary_raw", "") != salary or old.get("location") != location
    if changed:
        for field in ("rank_score", "rank_verdict", "rank_date", "strengths", "gaps", "location_verdict",
                      "language_gate", "language_note", "fetch_attempts", "first_unreachable", "last_fetch_error"):
            entry.pop(field, None)
    entry.update(company=company.strip(), title=title.strip(), location=location.strip(),
                 url=url, source="manual", portal=portal,
                 first_seen=old.get("first_seen", date.today().isoformat()),
                 status="new" if changed else old.get("status", "new"),
                 deadline=old.get("deadline"), posted_date=old.get("posted_date"),
                 posting_file=posting_file, posting_sha256=digest, salary_raw=salary,
                 salary=salary_info(salary) if salary else None, guard=findings["verdict"],
                 review_required="⚠" in findings["verdict"])
    counts = {k: len(v) if isinstance(v, list) else v for k, v in findings.items()
              if k != "verdict" and isinstance(v, (list, int))}
    entry["guard_counts"] = counts
    if write:
        # 岗位正文仅保留清洗结果和发现数量，隐藏内容不写入后续会读取的存档。
        target = root / posting_file
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(cleaned, encoding="utf-8")
        state_path.parent.mkdir(parents=True, exist_ok=True)
        doc["seen"][key] = entry
        save_state(state_path, doc)
    return {"key": key, "written": write, "entry": entry,
            "findings": findings, "preview": cleaned if not write else None}


def show_posting(root: Path, key: str) -> dict:
    """仅从岗位资料目录读取完整正文，并确认它与排序状态对应。"""
    doc = json.loads((root / "job_scraper/seen_jobs.json").read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or not isinstance(doc.get("seen"), dict):
        raise ValueError("岗位状态格式错误")
    entry = doc["seen"].get(key)
    if not isinstance(entry, dict) or not isinstance(entry.get("posting_file"), str):
        raise ValueError("找不到该 key 对应的人工导入正文")
    posting = (root / entry["posting_file"]).resolve()
    if not posting.is_relative_to((root / "documents/postings").resolve()):
        raise ValueError("岗位正文路径必须位于 documents/postings 下")
    text = posting.read_text(encoding="utf-8")
    if hashlib.sha256(text.encode("utf-8")).hexdigest() != entry.get("posting_sha256"):
        raise ValueError("正文与导入状态不一致，请重新导入后评分")
    return {"key": key, "entry": entry, "posting": text}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    salary = sub.add_parser("salary", help="解释人民币招聘薪资")
    salary.add_argument("text")
    search = sub.add_parser("search-plan", help="生成国内社招搜索计划，不联网")
    search.add_argument("--role", required=True)
    search.add_argument("--city", required=True)
    search.add_argument("--portal", choices=PORTALS, action="append")
    imp = sub.add_parser("import", help="导入本地岗位正文，默认只预览")
    imp.add_argument("--file", type=Path, required=True)
    imp.add_argument("--company", required=True)
    imp.add_argument("--title", required=True)
    imp.add_argument("--location", default="")
    imp.add_argument("--url", default="")
    imp.add_argument("--salary", default="")
    imp.add_argument("--write", action="store_true")
    show = sub.add_parser("show", help="读取已导入的岗位正文，不访问网站")
    show.add_argument("key")
    args = parser.parse_args()
    try:
        if args.command == "salary":
            result = salary_info(args.text)
        elif args.command == "search-plan":
            result = search_plan(args.role, args.city, args.portal or list(PORTALS))
        elif args.command == "show":
            result = show_posting(ROOT, args.key)
        else:
            result = import_posting(ROOT, args.file.read_text(encoding="utf-8"), args.company,
                                    args.title, args.location, args.url, args.salary, args.write)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
